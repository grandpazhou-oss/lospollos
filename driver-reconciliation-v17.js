(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const reducer = root?.STCTV17?.executionReducer || (typeof require === "function" ? require("./execution-reducer-v17.js") : null);
  const projection = root?.STCTV17?.driverLocalProjection || (typeof require === "function" ? require("./driver-local-projection-v17.js") : null);
  const api = factory(integrity, reducer, projection);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV17 = root.STCTV17 || { version: "1.7.0" }; root.STCTV17.driverReconciliation = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash, Reducer, Projection) {
  "use strict";
  if (!IntegrityHash?.hashValue || !Reducer?.createEvent || !Projection?.rebuild) throw new Error("Driver Reconciliation v1.7 dependencies are missing.");

  const VERSION = "stct-driver-reconciliation-v1.7";
  const SCHEMA_VERSION = "stct-driver-offline-queue-v1.7";
  const STATES = Object.freeze(["LOCAL_PENDING", "SENDING", "ACKED", "DUPLICATE_IDEMPOTENT", "CONFLICT", "PERMANENT_FAILURE", "RETRYABLE_FAILURE", "BLOCKED_DEPENDENCY", "DISCARDED"]);
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  function fail(code, message, detail = {}) { const error = new Error(message); error.code = code; error.detail = clone(detail); throw error; }
  function memoryStorage() { const rows = new Map(); return { getItem: (key) => rows.has(key) ? rows.get(key) : null, setItem: (key, value) => rows.set(key, value), removeItem: (key) => rows.delete(key) }; }

  function createSession(options = {}) {
    const run = clone(options.run || {}); const plan = clone(options.plan || {}); const store = options.store; const storage = options.storage || memoryStorage(); const storageKey = text(options.storageKey || "stct-driver-reconciliation-v17");
    const maxItems = Math.max(1, Number(options.maxItems || 100)); const clock = options.clock || (() => new Date().toISOString());
    if (!run.executionRunHash || !Array.isArray(plan.routes) || !store?.append || !store?.snapshot) fail("DRIVER_RECONCILIATION_INPUT_REQUIRED", "Reconciliation requires run, plan, and authoritative store.");
    let connectionState = "ONLINE"; let queue = []; let ackAudit = []; let recoveryLinks = []; let focus = clone(options.initialFocus || { type: "", id: "" }); let corruption = null; let migration = null; let localCounter = 0; let reservation = Math.max(0, ...(store.snapshot().acceptedEvents || []).map((event) => event.sequence || 0)); const authoritativeReceipts = new Map();

    function hydrate() {
      const raw = storage.getItem(storageKey); if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion === "stct-offline-queue-v1.6") {
          migration = { from: parsed.schemaVersion, to: SCHEMA_VERSION };
          queue = (parsed.queue || []).map((item, index) => ({ schemaVersion: "stct-driver-queue-item-v1.7", clientEventId: text(item.localEventId || item.event?.eventId), idempotencyKey: IntegrityHash.hashValue({ migrated: item.event?.eventHash }), localSequence: Number(item.event?.sequence || reservation + index + 1), event: clone(item.event), status: item.status === "PENDING" ? "LOCAL_PENDING" : text(item.status || "LOCAL_PENDING"), dependsOn: [], dependencyChain: [], attempts: Number(item.attempts || 0), errorCode: text(item.errorCode) }));
        } else if (parsed.schemaVersion === SCHEMA_VERSION && Array.isArray(parsed.queue)) { queue = parsed.queue.filter((item) => item && item.event && STATES.includes(item.status)).map(clone); ackAudit = clone(parsed.ackAudit || []); recoveryLinks = clone(parsed.recoveryLinks || []); focus = clone(parsed.focus || focus); reservation = Math.max(reservation, Number(parsed.localSequenceReservation || 0)); localCounter = Number(parsed.localCounter || 0); }
        else throw new Error("unsupported schema");
      } catch (error) { corruption = { code: "OFFLINE_QUEUE_CORRUPT", message: error.message, recoverable: true }; queue = []; ackAudit = []; }
    }
    function persist() { storage.setItem(storageKey, JSON.stringify({ schemaVersion: SCHEMA_VERSION, queue, ackAudit, recoveryLinks, focus, localSequenceReservation: reservation, localCounter })); }
    hydrate();

    function pending() { return queue.filter((item) => !["ACKED", "DISCARDED"].includes(item.status)); }
    function projection() { return Projection.rebuild({ authoritativeState: store.snapshot(), plan, pendingEvents: pending(), noWebGL: options.noWebGL === true }); }
    function viewState() { return connectionState === "ONLINE" ? { source: "AUTHORITATIVE", state: store.snapshot() } : { source: "LOCAL_PROJECTION", state: projection() }; }
    function legalActions(vehicleId) {
      if (connectionState === "ONLINE") {
        const state = store.snapshot(); const route = Object.values(state.routeStates || {}).find((row) => !vehicleId || row.vehicleId === vehicleId); const cursor = route ? state.routeCursors?.[route.routeId] : null; const stop = cursor?.nextActionableStopId ? state.stopStates?.[cursor.nextActionableStopId] : null;
        return { source: "AUTHORITATIVE", routeId: route?.routeId || "", vehicleId: route?.vehicleId || vehicleId, currentStopId: stop?.orderId || "", acceptRoute: route?.state === "RELEASED", depart: route?.state === "ACCEPTED", arrive: ["DEPARTED", "IN_PROGRESS"].includes(route?.state) && stop?.state === "EN_ROUTE", startService: stop?.state === "ARRIVED", complete: stop?.state === "SERVING", fail: ["EN_ROUTE", "ARRIVED", "SERVING"].includes(stop?.state), skip: ["EN_ROUTE", "ARRIVED", "SERVING"].includes(stop?.state) };
      }
      return Projection.legalActions(projection(), { vehicleId });
    }
    function setOffline() { connectionState = "OFFLINE"; return snapshot(); }
    function beginSync() { connectionState = "SYNCING"; return snapshot(); }
    function reserveSequence() { reservation += 1; persist(); return reservation; }
    function lastVehicleDependency(vehicleId) { return [...pending()].reverse().find((item) => item.event.vehicleId === vehicleId)?.clientEventId || ""; }
    function queueEvent(eventType, fields = {}) {
      if (connectionState === "ONLINE") fail("DRIVER_OFFLINE_REQUIRED", "Local queue actions require Offline or Syncing state.");
      const nextCounter = localCounter + 1; const clientEventId = text(fields.clientEventId || `CLIENT-${String(nextCounter).padStart(6, "0")}`); const existing = queue.find((item) => item.clientEventId === clientEventId);
      const routeId = text(fields.routeId); const route = plan.routes.find((row) => row.routeId === routeId); const vehicleId = text(fields.vehicleId || route?.vehicleId);
      const intentIdentity = { eventType: text(eventType).toUpperCase(), routeId, vehicleId, orderId: text(fields.orderId), payload: clone(fields.payload || {}) }; const intentHash = IntegrityHash.hashValue(intentIdentity);
      if (existing) {
        if (existing.intentHash === intentHash) return { status: "DUPLICATE_IDEMPOTENT", item: clone(existing), projection: projection() };
        existing.status = "CONFLICT"; existing.errorCode = "CLIENT_EVENT_ID_PAYLOAD_CONFLICT"; persist(); return { status: "CONFLICT", item: clone(existing), projection: projection() };
      }
      if (queue.length >= maxItems) fail("OFFLINE_QUEUE_SIZE_LIMIT", `Offline queue limit of ${maxItems} items reached.`);
      const explicitSequence = fields.localSequence == null ? null : Number(fields.localSequence);
      if (explicitSequence !== null && (!Number.isInteger(explicitSequence) || explicitSequence <= reservation)) fail("OFFLINE_SEQUENCE_RESERVATION_STALE", "Explicit local sequence must be greater than the current reservation.", { reservation, explicitSequence });
      const localSequence = explicitSequence === null ? reserveSequence() : explicitSequence; if (explicitSequence !== null) { reservation = explicitSequence; persist(); }
      localCounter = nextCounter; const dependency = lastVehicleDependency(vehicleId); const intent = { clientEventId, eventType, localSequence, routeId, vehicleId, orderId: text(fields.orderId), payload: clone(fields.payload || {}) }; const idempotencyKey = text(fields.idempotencyKey || IntegrityHash.hashValue(intent));
      const event = Reducer.createEvent(run, { eventId: text(fields.eventId || `${run.executionRunId || "RUN"}-${clientEventId}`), sequence: localSequence, eventType, logicalTime: Number(fields.logicalTime ?? projection().projectedLatestLogicalTime + 1), routeId, vehicleId, orderId: text(fields.orderId), coordinate: fields.coordinate, roadEdgeId: fields.roadEdgeId, source: "LOCAL_DRIVER_SIMULATOR", clientEventId, idempotencyKey, payload: { planRevision: Number(run.revision), routeRevision: Number(run.revision), localSimulation: true, ...(fields.payload || {}) } });
      const candidate = { schemaVersion: "stct-driver-queue-item-v1.7", clientEventId, intentHash, idempotencyKey, localSequence, event, status: "LOCAL_PENDING", dependsOn: dependency ? [dependency] : [], dependencyChain: dependency ? [...(queue.find((item) => item.clientEventId === dependency)?.dependencyChain || []), dependency] : [], attempts: 0, errorCode: "", authoritativeEventId: "", authoritativeSequence: null, createdAt: clock() };
      const projected = Projection.rebuild({ authoritativeState: store.snapshot(), plan, pendingEvents: [...pending(), candidate], noWebGL: options.noWebGL === true });
      const conflict = projected.conflicts.find((row) => row.clientEventId === clientEventId);
      if (conflict) fail(conflict.code, "Offline event is illegal in the Local Projection.", conflict);
      queue.push(candidate); persist(); return { status: "LOCAL_PENDING", item: clone(candidate), projection: projection() };
    }

    function authoritativeSend(event) {
      const receiptKey = text(event.idempotencyKey || event.clientEventId || event.eventId); const prior = authoritativeReceipts.get(receiptKey); if (prior) return { ...clone(prior), status: "DUPLICATE_IDEMPOTENT" };
      const authoritativeSequence = store.snapshot().acceptedEvents.length + 1;
      const authoritativeEvent = Reducer.createEvent(run, { ...event, sequence: authoritativeSequence, authoritativeSequence, authoritativeEventId: event.eventId });
      const result = store.append(authoritativeEvent);
      if (result.status === "ACCEPTED") { const receipt = { status: "ACK", authoritativeEventId: result.event.eventId, authoritativeSequence: result.event.sequence, authoritativeEventHash: result.event.eventHash, ackId: `ACK-${result.event.eventHash.slice(-12)}` }; authoritativeReceipts.set(receiptKey, receipt); return clone(receipt); }
      if (result.status === "DUPLICATE_IDEMPOTENT") return { status: "DUPLICATE_IDEMPOTENT", authoritativeEventId: result.event.eventId, authoritativeSequence: result.event.sequence, authoritativeEventHash: result.event.eventHash, ackId: `ACK-${result.event.eventHash.slice(-12)}` };
      if (["EXECUTION_EVENT_ID_CONFLICT", "EXECUTION_SEQUENCE_GAP", "EXECUTION_SEQUENCE_OUT_OF_ORDER", "EXECUTION_REVISION_STALE", "EXECUTION_PLAN_REVISION_STALE", "EXECUTION_ROUTE_REVISION_STALE"].includes(result.code)) return { status: "CONFLICT", errorCode: result.code };
      return { status: "PERMANENT_FAILURE", errorCode: result.code || "EXECUTION_STORE_REJECTED" };
    }

    async function reconcile(sender = authoritativeSend) {
      connectionState = "SYNCING"; const results = [];
      for (const item of [...queue].sort((a, b) => a.localSequence - b.localSequence)) {
        if (!["LOCAL_PENDING", "RETRYABLE_FAILURE"].includes(item.status)) continue;
        const blocking = item.dependsOn.map((id) => queue.find((row) => row.clientEventId === id)).find((row) => row && ["CONFLICT", "PERMANENT_FAILURE", "BLOCKED_DEPENDENCY"].includes(row.status));
        if (blocking) { item.status = "BLOCKED_DEPENDENCY"; item.errorCode = `DEPENDS_ON_${blocking.clientEventId}`; results.push(clone(item)); persist(); continue; }
        item.status = "SENDING"; item.attempts += 1; persist();
        let response; try { response = await sender(clone(item.event)); } catch (error) { response = { status: "RETRYABLE_FAILURE", errorCode: text(error.code || "NETWORK_ERROR") }; }
        if (["ACK", "DUPLICATE_IDEMPOTENT"].includes(response?.status)) {
          if (sender !== authoritativeSend) {
            const authoritative = authoritativeSend(item.event);
            if (!["ACK", "DUPLICATE_IDEMPOTENT"].includes(authoritative.status)) response = authoritative;
            else response = { ...authoritative, status: response.status };
          }
          if (["ACK", "DUPLICATE_IDEMPOTENT"].includes(response.status)) {
            item.status = response.status === "ACK" ? "ACKED" : "DUPLICATE_IDEMPOTENT"; item.authoritativeEventId = text(response.authoritativeEventId || item.event.eventId); item.authoritativeSequence = Number(response.authoritativeSequence ?? item.event.sequence); item.errorCode = "";
            ackAudit.push({ clientEventId: item.clientEventId, idempotencyKey: item.idempotencyKey, eventHash: item.event.eventHash, authoritativeEventId: item.authoritativeEventId, authoritativeSequence: item.authoritativeSequence, reconciliationStatus: item.status, acknowledgedAt: clock() });
          }
        }
        if (response?.status === "CONFLICT") { item.status = "CONFLICT"; item.errorCode = text(response.errorCode || "AUTHORITATIVE_CONFLICT"); }
        else if (response?.status === "PERMANENT_FAILURE") { item.status = "PERMANENT_FAILURE"; item.errorCode = text(response.errorCode || "PERMANENT_FAILURE"); }
        else if (!["ACK", "DUPLICATE_IDEMPOTENT"].includes(response?.status)) { item.status = "RETRYABLE_FAILURE"; item.errorCode = text(response?.errorCode || "AMBIGUOUS_RESPONSE"); }
        results.push(clone(item)); persist();
      }
      queue = queue.filter((item) => !["ACKED", "DUPLICATE_IDEMPOTENT"].includes(item.status));
      const unresolved = pending().filter((item) => ["CONFLICT", "PERMANENT_FAILURE", "RETRYABLE_FAILURE", "BLOCKED_DEPENDENCY"].includes(item.status)); connectionState = unresolved.length ? "OFFLINE" : "ONLINE"; persist();
      return { status: unresolved.length ? "RECONCILIATION_PARTIAL" : "RECONCILED", connectionState, results, remaining: clone(queue), projection: projection(), ackAudit: clone(ackAudit) };
    }

    function manualRetry(clientEventId) { const item = queue.find((row) => row.clientEventId === clientEventId); if (!item) fail("OFFLINE_EVENT_NOT_FOUND", "Pending local event was not found."); item.status = "LOCAL_PENDING"; item.errorCode = ""; persist(); return clone(item); }
    function discardLocalBranch(clientEventId, confirm) { if (confirm !== true) fail("OFFLINE_DISCARD_CONFIRMATION_REQUIRED", "Discarding a local branch requires confirmation."); const remove = new Set([clientEventId]); let changed = true; while (changed) { changed = false; queue.forEach((item) => { if (item.dependsOn.some((id) => remove.has(id)) && !remove.has(item.clientEventId)) { remove.add(item.clientEventId); changed = true; } }); } queue = queue.filter((item) => !remove.has(item.clientEventId)); persist(); return { status: "DISCARDED", clientEventIds: [...remove], projection: projection() }; }
    function editAndRetry(clientEventId, patch = {}) { const item = queue.find((row) => row.clientEventId === clientEventId); if (!item) fail("OFFLINE_EVENT_NOT_FOUND", "Pending local event was not found."); const updatedPayload = { ...item.event.payload, ...(patch.payload || {}) }; item.event = Reducer.createEvent(run, { ...item.event, eventId: `${item.event.eventId}-EDIT-${item.attempts + 1}`, payload: updatedPayload }); item.idempotencyKey = IntegrityHash.hashValue({ clientEventId, eventHash: item.event.eventHash, edit: item.attempts + 1 }); item.event.idempotencyKey = item.idempotencyKey; item.event.eventHash = IntegrityHash.hashValue(Reducer.eventIdentity(item.event)); item.status = "LOCAL_PENDING"; item.errorCode = ""; persist(); return clone(item); }
    function createIncident(clientEventId, note = "") { const item = queue.find((row) => row.clientEventId === clientEventId); if (!item) fail("OFFLINE_EVENT_NOT_FOUND", "Pending local event was not found."); const incident = { schemaVersion: "stct-offline-conflict-incident-v1.7", clientEventId, eventHash: item.event.eventHash, dependencyChain: clone(item.dependencyChain), errorCode: item.errorCode, note: text(note), source: "LOCAL_DRIVER_RECONCILIATION" }; incident.incidentHash = IntegrityHash.hashValue(incident); return incident; }
    function linkCounterRecovery(clientEventId, counterRecovery = {}) { const item = queue.find((row) => row.clientEventId === clientEventId); if (!item) fail("OFFLINE_EVENT_NOT_FOUND", "Pending local event was not found."); const link = { schemaVersion: "stct-conflict-counter-recovery-link-v1.7", clientEventId, conflictEventHash: item.event.eventHash, counterRecoveryId: text(counterRecovery.counterRecoveryId || counterRecovery.sessionId), counterRecoveryHash: text(counterRecovery.counterRecoveryHash || counterRecovery.sessionHash), linkedAt: clock() }; if (!link.counterRecoveryId || !link.counterRecoveryHash) fail("COUNTER_RECOVERY_LINK_REQUIRED", "Counter-recovery identity and hash are required."); link.linkHash = IntegrityHash.hashValue(link); recoveryLinks.push(link); persist(); return clone(link); }
    function setFocus(nextFocus = {}) { focus = { type: text(nextFocus.type), id: text(nextFocus.id) }; persist(); return clone(focus); }
    function clear(confirm) { if (confirm !== true) fail("OFFLINE_QUEUE_CLEAR_CONFIRMATION_REQUIRED", "Clearing the offline queue requires confirmation."); const removed = queue.length; queue = []; persist(); return { status: "CLEARED", removed, ackAuditRetained: ackAudit.length }; }
    function summary() { const counts = Object.fromEntries(STATES.map((state) => [state, queue.filter((item) => item.status === state).length])); const unresolvedConflicts = queue.filter((item) => ["CONFLICT", "BLOCKED_DEPENDENCY"].includes(item.status)).length; return { schemaVersion: SCHEMA_VERSION, connectionState, counts, total: queue.length, pending: pending().length, unresolvedConflicts, ackAuditCount: ackAudit.length, recoveryLinkCount: recoveryLinks.length, localSequenceReservation: reservation, focus: clone(focus), corruption: clone(corruption), migration: clone(migration), storage: options.storage ? "BROWSER_BUILT_IN_STORAGE" : "MEMORY", containsLocalPath: false, simulationBoundary: "LOCAL_SIMULATION_NOT_REAL_DRIVER_PLATFORM", degradation: queue.length > 20 ? "SUMMARY_ONLY_OVER_20" : "FULL_DETAIL", screenReaderSummary: `${connectionState}. ${pending().length} pending local events. ${unresolvedConflicts} unresolved conflicts.` }; }
    function snapshot() { return { schemaVersion: SCHEMA_VERSION, connectionState, queue: clone(queue), ackAudit: clone(ackAudit), recoveryLinks: clone(recoveryLinks), focus: clone(focus), projection: projection(), authoritativeStateHash: store.snapshot().executionStateHash, summary: summary() }; }
    return { VERSION, SCHEMA_VERSION, STATES, setOffline, beginSync, queueEvent, reconcile, authoritativeSend, manualRetry, discardLocalBranch, editAndRetry, createIncident, linkCounterRecovery, setFocus, getFocus: () => clone(focus), clear, legalActions, projection, viewState, summary, snapshot, list: () => clone(queue), ackAudit: () => clone(ackAudit), recoveryLinks: () => clone(recoveryLinks), store };
  }

  return { VERSION, SCHEMA_VERSION, STATES, createSession, memoryStorage };
});
