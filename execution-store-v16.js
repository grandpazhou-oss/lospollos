(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const twin = root?.STCTV16?.executionTwin || (typeof require === "function" ? require("./execution-twin-v16.js") : null);
  const api = factory(integrity, twin);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV16 = root.STCTV16 || { version: "1.6.0" }; root.STCTV16.executionStore = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash, Twin) {
  "use strict";
  if (!IntegrityHash?.hashValue || !Twin) throw new Error("Execution Store v1.6 dependencies are missing.");
  const VERSION = "stct-execution-store-v1.6";
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  function fail(code, message, detail = {}) { const error = new Error(message); error.code = code; error.detail = clone(detail); throw error; }
  function stateIdentity(state) { return { run: state.run, acceptedEventHashes: state.acceptedEvents.map((event) => event.eventHash), routeStates: state.routeStates, stopStates: state.stopStates, vehicleStates: state.vehicleStates, latestLogicalTime: state.latestLogicalTime, staleStatus: state.staleStatus }; }
  function initialState(run, plan, options = {}) {
    const routes = plan?.routes || []; const routeStates = {}; const stopStates = {}; const vehicleStates = {};
    routes.forEach((route) => { routeStates[route.routeId] = { routeId: route.routeId, vehicleId: route.vehicleId, state: "PLANNED", activeStopId: "", completedStopIds: [], failedStopIds: [] }; vehicleStates[route.vehicleId] = { vehicleId: route.vehicleId, routeId: route.routeId, state: "PLANNED", coordinate: null, roadEdgeId: "", offRoute: false, available: true }; (route.orderIds || []).forEach((orderId) => { stopStates[orderId] = { orderId, routeId: route.routeId, vehicleId: route.vehicleId, state: "PENDING", arrivedAt: null, serviceStartedAt: null, completedAt: null }; }); });
    const state = { schemaVersion: "stct-execution-state-v1.6", authority: "EXECUTION_STORE_V16", run: clone(run), acceptedEvents: [], rejectedEvents: [], routeStates, stopStates, vehicleStates, latestLogicalTime: run.logicalStartMinute, latestRecordedAt: options.clock?.() || "1970-01-01T00:00:00.000Z", executionStateHash: "", staleStatus: options.noWebGL ? "LIVE_SIMULATION_NO_WEBGL" : "LIVE_SIMULATION", lastKnownGood: null };
    state.executionStateHash = IntegrityHash.hashValue(stateIdentity(state)); state.lastKnownGood = { executionStateHash: state.executionStateHash, latestLogicalTime: state.latestLogicalTime }; return state;
  }
  function createStore(options = {}) {
    const run = clone(options.run || {}); const plan = clone(options.plan || {}); if (!text(run.executionRunHash) || !Array.isArray(plan.routes)) fail("EXECUTION_STORE_INPUT_REQUIRED", "ExecutionStore requires a run and plan routes.");
    let state = initialState(run, plan, options); const eventsById = new Map();
    function reject(code, event, message, detail = {}) { const row = { status: "REJECTED", code, eventId: text(event?.eventId), sequence: event?.sequence, message, detail: clone(detail) }; state.rejectedEvents.push(row); if (["EXECUTION_SEQUENCE_GAP", "EXECUTION_SEQUENCE_OUT_OF_ORDER"].includes(code)) state.staleStatus = "PARTIAL_EVENTS"; if (code === "EXECUTION_EVENT_ID_CONFLICT") state.staleStatus = "EVENT_CONFLICT"; return row; }
    function route(event) { const value = state.routeStates[event.routeId]; if (!value) fail("EXECUTION_ROUTE_NOT_FOUND", `Unknown route: ${event.routeId}`); return value; }
    function stop(event) { const value = state.stopStates[event.orderId]; if (!value) fail("EXECUTION_STOP_NOT_FOUND", `Unknown stop: ${event.orderId}`); return value; }
    function requireState(actual, allowed, code, label) { if (!allowed.includes(actual)) fail(code, `${label} state ${actual} cannot accept this event.`, { actual, allowed }); }
    function apply(event) {
      let routeState; let stopState; let vehicleState;
      if (event.routeId) { routeState = route(event); vehicleState = state.vehicleStates[event.vehicleId || routeState.vehicleId]; }
      if (event.orderId && state.stopStates[event.orderId]) stopState = stop(event);
      switch (event.eventType) {
        case "RUN_RELEASED": requireState(state.run.status, ["PREPARED"], "EXECUTION_RUN_TRANSITION_INVALID", "Run"); state.run.status = "RELEASED"; Object.values(state.routeStates).forEach((row) => { if (row.state === "PLANNED") row.state = "RELEASED"; }); break;
        case "ROUTE_ACCEPTED": requireState(routeState.state, ["RELEASED"], "EXECUTION_ROUTE_TRANSITION_INVALID", "Route"); routeState.state = "ACCEPTED"; if (vehicleState) vehicleState.state = "ACCEPTED"; break;
        case "VEHICLE_DEPARTED": requireState(routeState.state, ["ACCEPTED"], "EXECUTION_ROUTE_TRANSITION_INVALID", "Route"); routeState.state = "DEPARTED"; if (vehicleState) vehicleState.state = "DEPARTED"; { const first = Object.values(state.stopStates).find((row) => row.routeId === routeState.routeId && row.state === "PENDING"); if (first) first.state = "EN_ROUTE"; } break;
        case "POSITION_RECORDED": requireState(routeState.state, ["DEPARTED", "IN_PROGRESS"], "EXECUTION_ROUTE_TRANSITION_INVALID", "Route"); routeState.state = "IN_PROGRESS"; if (vehicleState) { vehicleState.state = "IN_PROGRESS"; vehicleState.coordinate = clone(event.coordinate); vehicleState.roadEdgeId = event.roadEdgeId; } break;
        case "STOP_ARRIVED": requireState(stopState.state, ["EN_ROUTE"], "EXECUTION_STOP_TRANSITION_INVALID", "Stop"); stopState.state = "ARRIVED"; stopState.arrivedAt = event.logicalTime; routeState.activeStopId = event.orderId; break;
        case "SERVICE_STARTED": requireState(stopState.state, ["ARRIVED"], "EXECUTION_SERVICE_START_BEFORE_ARRIVAL", "Stop"); stopState.state = "SERVING"; stopState.serviceStartedAt = event.logicalTime; break;
        case "SERVICE_COMPLETED": requireState(stopState.state, ["SERVING"], "EXECUTION_COMPLETE_BEFORE_SERVICE", "Stop"); stopState.state = "COMPLETED"; stopState.completedAt = event.logicalTime; routeState.completedStopIds.push(event.orderId); routeState.activeStopId = ""; { const next = Object.values(state.stopStates).find((row) => row.routeId === routeState.routeId && row.state === "PENDING"); if (next) next.state = "EN_ROUTE"; } break;
        case "STOP_FAILED": requireState(stopState.state, ["EN_ROUTE", "ARRIVED", "SERVING"], "EXECUTION_STOP_TRANSITION_INVALID", "Stop"); stopState.state = "FAILED"; routeState.failedStopIds.push(event.orderId); routeState.activeStopId = ""; break;
        case "STOP_SKIPPED": requireState(stopState.state, ["PENDING", "EN_ROUTE", "ARRIVED"], "EXECUTION_STOP_TRANSITION_INVALID", "Stop"); stopState.state = "SKIPPED"; routeState.activeStopId = ""; break;
        case "UNPLANNED_STOP": if (vehicleState) vehicleState.unplannedStopCount = (vehicleState.unplannedStopCount || 0) + 1; break;
        case "OFF_ROUTE_DETECTED": if (vehicleState) vehicleState.offRoute = true; break;
        case "ROUTE_REJOINED": if (vehicleState) vehicleState.offRoute = false; break;
        case "VEHICLE_BREAKDOWN": requireState(routeState.state, ["DEPARTED", "IN_PROGRESS"], "EXECUTION_ROUTE_TRANSITION_INVALID", "Route"); routeState.state = "FAILED"; if (vehicleState) { vehicleState.state = "FAILED"; vehicleState.available = false; } break;
        case "ORDER_CANCELLED": requireState(stopState.state, ["PENDING", "EN_ROUTE"], "EXECUTION_STOP_TRANSITION_INVALID", "Stop"); stopState.state = "CANCELLED"; break;
        case "NETWORK_OFFLINE": state.staleStatus = "OFFLINE_QUEUEING"; break;
        case "NETWORK_RESTORED": state.staleStatus = "LIVE_SIMULATION"; break;
        case "EVENT_ACKNOWLEDGED": break;
        case "RUN_COMPLETED": requireState(state.run.status, ["RELEASED", "RUNNING", "PAUSED"], "EXECUTION_RUN_TRANSITION_INVALID", "Run"); state.run.status = "COMPLETED"; Object.values(state.routeStates).forEach((row) => { if (!["FAILED", "CANCELLED"].includes(row.state)) row.state = "COMPLETED"; }); state.staleStatus = "COMPLETED"; break;
        default: fail("EXECUTION_EVENT_TYPE_INVALID", `Unsupported event: ${event.eventType}`);
      }
      if (!["NETWORK_OFFLINE", "NETWORK_RESTORED", "RUN_COMPLETED"].includes(event.eventType) && ["RELEASED", "RUNNING", "PAUSED"].includes(state.run.status)) state.run.status = "RUNNING";
    }
    function append(input) {
      Twin.assertSafe(input); const rawId = text(input?.eventId); const existing = eventsById.get(rawId);
      if (existing) { const expected = IntegrityHash.hashValue(Twin.eventIdentity({ ...input, schemaVersion: "stct-execution-event-v1.6", eventHash: undefined, coordinate: input.coordinate ?? null, routeId: text(input.routeId), vehicleId: text(input.vehicleId), orderId: text(input.orderId), roadEdgeId: text(input.roadEdgeId), source: text(input.source || "LOCAL_SIMULATION"), ackId: text(input.ackId), payload: clone(input.payload || {}) })); if (expected === existing.eventHash) return { status: "DUPLICATE_IDEMPOTENT", event: clone(existing), state: snapshot() }; return reject("EXECUTION_EVENT_ID_CONFLICT", input, "The same eventId has different semantic content.", { existingHash: existing.eventHash, incomingHash: expected }); }
      let event; try { event = Twin.normalizeEvent(state.run, input); } catch (error) { return reject(error.code || "EXECUTION_EVENT_INVALID", input, error.message, error.detail); }
      if (event.executionRunHash !== state.run.executionRunHash) return reject("EXECUTION_RUN_HASH_MISMATCH", event, "Event belongs to another execution run.");
      if (event.executionRevision !== state.run.revision) return reject("EXECUTION_REVISION_STALE", event, "Event execution revision is stale.", { expected: state.run.revision, actual: event.executionRevision });
      if (event.payload?.planRevision !== undefined && Number(event.payload.planRevision) !== state.run.revision) return reject("EXECUTION_PLAN_REVISION_STALE", event, "Event plan revision is stale.", { expected: state.run.revision, actual: event.payload.planRevision });
      const expectedSequence = state.acceptedEvents.length + 1; if (event.sequence !== expectedSequence) return reject(event.sequence < expectedSequence ? "EXECUTION_SEQUENCE_OUT_OF_ORDER" : "EXECUTION_SEQUENCE_GAP", event, "Execution event sequence is not the next accepted sequence.", { expectedSequence, actualSequence: event.sequence });
      if (event.logicalTime < state.latestLogicalTime) return reject("EXECUTION_LOGICAL_TIME_OUT_OF_ORDER", event, "Execution event logical time moved backwards.", { latest: state.latestLogicalTime, actual: event.logicalTime });
      const before = clone(state); try { apply(event); } catch (error) { state = before; return reject(error.code || "EXECUTION_STATE_TRANSITION_INVALID", event, error.message, error.detail); }
      state.acceptedEvents.push(clone(event)); eventsById.set(event.eventId, clone(event)); state.latestLogicalTime = event.logicalTime; state.latestRecordedAt = options.clock?.() || "1970-01-01T00:00:00.000Z"; state.executionStateHash = IntegrityHash.hashValue(stateIdentity(state)); state.lastKnownGood = { executionStateHash: state.executionStateHash, latestLogicalTime: state.latestLogicalTime, acceptedEventCount: state.acceptedEvents.length }; return { status: "ACCEPTED", event: clone(event), state: snapshot() };
    }
    function snapshot() { return clone(state); }
    function markStale(currentLogicalMinute) { const age = Number(currentLogicalMinute) - state.latestLogicalTime; if (age >= Number(options.staleAfterMinutes || 15) && !["OFFLINE_QUEUEING", "COMPLETED"].includes(state.staleStatus)) state.staleStatus = "STALE"; state.executionStateHash = IntegrityHash.hashValue(stateIdentity(state)); return snapshot(); }
    function exportState() { const body = { schemaVersion: "stct-execution-export-v1.6", run: clone(run), plan: clone(plan), acceptedEvents: clone(state.acceptedEvents).sort((a, b) => a.sequence - b.sequence), rejectedEvents: clone(state.rejectedEvents), finalExecutionStateHash: state.executionStateHash, dataClassification: "SYNTHETIC" }; body.exportHash = IntegrityHash.hashValue(body); return body; }
    return { authority: "EXECUTION_STORE_V16", append, snapshot, markStale, exportState };
  }
  function rebuild(exported, options = {}) { Twin.assertSafe(exported); const expected = IntegrityHash.hashValue(Object.fromEntries(Object.entries(exported).filter(([key]) => key !== "exportHash"))); if (exported.exportHash && exported.exportHash !== expected) fail("EXECUTION_EXPORT_HASH_STALE", "Execution export hash is stale."); const store = createStore({ run: exported.run, plan: exported.plan, ...options }); for (const event of [...(exported.acceptedEvents || [])].sort((a, b) => a.sequence - b.sequence)) { const result = store.append(event); if (result.status !== "ACCEPTED") fail("EXECUTION_IMPORT_EVENT_REJECTED", "An imported execution event was rejected.", result); } return store; }
  return { VERSION, stateIdentity, initialState, createStore, rebuild };
});
