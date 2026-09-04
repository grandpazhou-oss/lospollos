(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const invariants = root?.STCTV17?.executionInvariants || (typeof require === "function" ? require("./execution-invariants-v17.js") : null);
  const twin = root?.STCTV16?.executionTwin || (typeof require === "function" ? require("./execution-twin-v16.js") : null);
  const api = factory(integrity, invariants, twin);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV17 = root.STCTV17 || { version: "1.7.0" }; root.STCTV17.executionReducer = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash, Invariants, Twin) {
  "use strict";
  if (!IntegrityHash?.hashValue || !Invariants || !Twin?.assertSafe) throw new Error("Execution Reducer v1.7 dependencies are missing.");

  const VERSION = "stct-execution-reducer-v1.7";
  const EVENT_TYPES = Object.freeze([
    "RUN_RELEASED", "RUN_PAUSED", "RUN_RESUMED", "RUN_CANCELLED", "RUN_COMPLETED",
    "ROUTE_ACCEPTED", "VEHICLE_DEPARTED", "POSITION_RECORDED", "STOP_ARRIVED", "SERVICE_STARTED",
    "SERVICE_COMPLETED", "STOP_FAILED", "STOP_SKIPPED", "ORDER_CANCELLED", "DISPATCHER_CANCEL_FUTURE_STOP",
    "UNPLANNED_STOP", "OFF_ROUTE_DETECTED", "ROUTE_REJOINED", "VEHICLE_BREAKDOWN",
    "NETWORK_OFFLINE", "NETWORK_RESTORED", "EVENT_ACKNOWLEDGED",
  ]);
  const RUN_EVENTS = new Set(["RUN_RELEASED", "RUN_PAUSED", "RUN_RESUMED", "RUN_CANCELLED", "RUN_COMPLETED", "NETWORK_OFFLINE", "NETWORK_RESTORED", "EVENT_ACKNOWLEDGED"]);
  const STOP_EVENTS = new Set(["STOP_ARRIVED", "SERVICE_STARTED", "SERVICE_COMPLETED", "STOP_FAILED", "STOP_SKIPPED", "ORDER_CANCELLED", "DISPATCHER_CANCEL_FUTURE_STOP"]);
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  function fail(code, message, detail = {}) { const error = new Error(message); error.code = code; error.detail = clone(detail); throw error; }
  function requireState(actual, allowed, code, label) { if (!allowed.includes(actual)) fail(code, `${label} state ${actual} cannot accept this event.`, { actual, allowed }); }
  function without(value, key) { const result = clone(value); delete result[key]; return result; }

  function eventIdentity(value) {
    return {
      schemaVersion: "stct-execution-event-v1.7",
      eventId: value.eventId,
      executionRunHash: value.executionRunHash,
      executionRevision: value.executionRevision,
      sequence: value.sequence,
      eventType: value.eventType,
      logicalTime: value.logicalTime,
      routeId: value.routeId,
      vehicleId: value.vehicleId,
      orderId: value.orderId,
      coordinate: value.coordinate,
      roadEdgeId: value.roadEdgeId,
      source: value.source,
      clientEventId: value.clientEventId,
      idempotencyKey: value.idempotencyKey,
      authoritativeEventId: value.authoritativeEventId,
      authoritativeSequence: value.authoritativeSequence,
      payload: value.payload,
    };
  }

  function createEvent(run, input = {}) {
    const value = {
      schemaVersion: "stct-execution-event-v1.7",
      eventId: text(input.eventId),
      executionRunHash: text(input.executionRunHash || run?.executionRunHash),
      executionRevision: Number(input.executionRevision ?? run?.revision),
      sequence: Number(input.sequence),
      eventType: text(input.eventType).toUpperCase(),
      logicalTime: Number(input.logicalTime),
      routeId: text(input.routeId),
      vehicleId: text(input.vehicleId),
      orderId: text(input.orderId),
      coordinate: input.coordinate === undefined ? null : clone(input.coordinate),
      roadEdgeId: text(input.roadEdgeId),
      source: text(input.source || "LOCAL_SIMULATION"),
      clientEventId: text(input.clientEventId),
      idempotencyKey: text(input.idempotencyKey),
      authoritativeEventId: text(input.authoritativeEventId),
      authoritativeSequence: input.authoritativeSequence == null ? null : Number(input.authoritativeSequence),
      payload: clone(input.payload || {}),
    };
    if (!value.eventId || !value.executionRunHash || !EVENT_TYPES.includes(value.eventType) || !Number.isInteger(value.sequence) || value.sequence < 1 || !Number.isFinite(value.logicalTime)) fail("EXECUTION_EVENT_INVALID", "Execution event identity is incomplete.", { eventId: value.eventId, eventType: value.eventType, sequence: value.sequence });
    value.eventHash = IntegrityHash.hashValue(eventIdentity(value));
    return value;
  }

  function normalizeEvent(run, input) {
    Twin.assertSafe(input);
    const event = createEvent(run, input);
    if (input.eventHash && input.eventHash !== event.eventHash) fail("EXECUTION_EVENT_HASH_MISMATCH", "Execution event hash is stale.");
    return event;
  }

  function stateIdentity(state) {
    return {
      run: state.run,
      acceptedEventHashes: (state.acceptedEvents || []).map((event) => event.eventHash),
      routeStates: state.routeStates,
      stopStates: state.stopStates,
      vehicleStates: state.vehicleStates,
      routeCursors: state.routeCursors,
      latestLogicalTime: state.latestLogicalTime,
      staleStatus: state.staleStatus,
      pendingQueueConflicts: state.pendingQueueConflicts,
    };
  }

  function initialState(run, plan, options = {}) {
    const routeStates = {}; const stopStates = {}; const vehicleStates = {};
    for (const route of plan?.routes || []) {
      routeStates[route.routeId] = { routeId: route.routeId, vehicleId: route.vehicleId, state: "PLANNED", activeStopId: "", completedStopIds: [], failedStopIds: [], skippedStopIds: [], cancelledStopIds: [] };
      vehicleStates[route.vehicleId] = { vehicleId: route.vehicleId, routeId: route.routeId, state: "PLANNED", coordinate: null, roadEdgeId: "", offRoute: false, available: true };
      for (const orderId of route.orderIds || []) stopStates[orderId] = { orderId, routeId: route.routeId, vehicleId: route.vehicleId, state: "PENDING", arrivedAt: null, serviceStartedAt: null, completedAt: null, terminalEventId: "" };
    }
    const state = { schemaVersion: "stct-execution-state-v1.7", authority: options.mode === "LOCAL_PROJECTION" ? "LOCAL_DRIVER_PROJECTION_V17" : "EXECUTION_STORE_V17", run: clone(run), planRevision: Number(run?.revision || plan?.revision || 1), acceptedEvents: [], routeStates, stopStates, vehicleStates, routeCursors: {}, latestLogicalTime: Number(run?.logicalStartMinute || 0), staleStatus: options.noWebGL ? "LIVE_SIMULATION_NO_WEBGL" : "LIVE_SIMULATION", pendingQueueConflicts: clone(options.pendingQueueConflicts || []), executionStateHash: "" };
    Invariants.refreshCursors(state, plan);
    state.executionStateHash = IntegrityHash.hashValue(stateIdentity(state));
    return state;
  }

  function terminalRouteState(state, routeId) {
    const routeState = state.routeStates[routeId];
    const orderIds = state.routeCursors[routeId] ? [...state.routeCursors[routeId].terminalStopIds] : [];
    const plannedCount = Object.values(state.stopStates).filter((stop) => stop.routeId === routeId).length;
    if (routeState.state === "FAILED" || orderIds.length !== plannedCount) return;
    const exceptionCount = routeState.failedStopIds.length + routeState.skippedStopIds.length + routeState.cancelledStopIds.length;
    routeState.state = exceptionCount ? "COMPLETED_WITH_EXCEPTIONS" : "COMPLETED";
    const vehicle = state.vehicleStates[routeState.vehicleId];
    if (vehicle && vehicle.state !== "FAILED") vehicle.state = routeState.state;
  }

  function advanceAfterTerminal(state, plan, routeId) {
    Invariants.refreshCursors(state, plan);
    const routeState = state.routeStates[routeId];
    const cursor = state.routeCursors[routeId];
    routeState.activeStopId = "";
    if (cursor.nextActionableStopId && ["DEPARTED", "IN_PROGRESS"].includes(routeState.state)) {
      const next = state.stopStates[cursor.nextActionableStopId];
      if (next.state === "PENDING") next.state = "EN_ROUTE";
    }
    Invariants.refreshCursors(state, plan);
    terminalRouteState(state, routeId);
    Invariants.refreshCursors(state, plan);
  }

  function applyTerminal(state, plan, event, terminalState) {
    const routeState = state.routeStates[event.routeId]; const stop = state.stopStates[event.orderId];
    if (Invariants.isTerminalStop(stop.state)) return { idempotent: stop.terminalEventId === event.eventId };
    const allowed = terminalState === "COMPLETED" ? ["SERVING"] : ["EN_ROUTE", "ARRIVED", "SERVING"];
    requireState(stop.state, allowed, terminalState === "COMPLETED" ? "EXECUTION_COMPLETE_BEFORE_SERVICE" : "EXECUTION_STOP_TRANSITION_INVALID", "Stop");
    stop.state = terminalState; stop.terminalEventId = event.eventId;
    if (terminalState === "COMPLETED") { stop.completedAt = event.logicalTime; routeState.completedStopIds.push(event.orderId); }
    if (terminalState === "FAILED") routeState.failedStopIds.push(event.orderId);
    if (terminalState === "SKIPPED") routeState.skippedStopIds.push(event.orderId);
    if (terminalState === "CANCELLED") routeState.cancelledStopIds.push(event.orderId);
    advanceAfterTerminal(state, plan, event.routeId);
    return { idempotent: false };
  }

  function applyEvent(current, plan, event, options = {}) {
    const state = clone(current);
    Invariants.assertAssociation(state, event);
    if (Invariants.RUN_TERMINAL.includes(state.run.status) && Invariants.BUSINESS_EVENTS.includes(event.eventType)) fail("EXECUTION_RUN_TERMINAL", "A terminal run cannot accept another business event.", { runStatus: state.run.status, eventType: event.eventType });
    if (state.run.status === "PAUSED" && Invariants.BUSINESS_EVENTS.includes(event.eventType) && event.eventType !== "POSITION_RECORDED") fail("EXECUTION_RUN_PAUSED", "Paused run cannot accept this business event.", { eventType: event.eventType });
    if (STOP_EVENTS.has(event.eventType)) Invariants.assertActionableStop(state, event);
    const routeState = event.routeId ? state.routeStates[event.routeId] : null;
    const stopState = event.orderId ? state.stopStates[event.orderId] : null;
    const vehicleState = routeState ? state.vehicleStates[event.vehicleId || routeState.vehicleId] : null;

    switch (event.eventType) {
      case "RUN_RELEASED":
        requireState(state.run.status, ["PREPARED"], "EXECUTION_RUN_TRANSITION_INVALID", "Run"); state.run.status = "RELEASED";
        Object.values(state.routeStates).forEach((route) => { if (route.state === "PLANNED") route.state = "RELEASED"; }); break;
      case "RUN_PAUSED": requireState(state.run.status, ["RELEASED", "RUNNING"], "EXECUTION_RUN_TRANSITION_INVALID", "Run"); state.run.status = "PAUSED"; break;
      case "RUN_RESUMED": requireState(state.run.status, ["PAUSED"], "EXECUTION_RUN_TRANSITION_INVALID", "Run"); state.run.status = "RUNNING"; break;
      case "RUN_CANCELLED":
        requireState(state.run.status, ["PREPARED", "RELEASED", "RUNNING", "PAUSED"], "EXECUTION_RUN_TRANSITION_INVALID", "Run"); state.run.status = "CANCELLED";
        Object.values(state.routeStates).forEach((route) => { if (!Invariants.isTerminalRoute(route.state)) route.state = "CANCELLED"; }); state.staleStatus = "CANCELLED"; break;
      case "ROUTE_ACCEPTED": requireState(routeState.state, ["RELEASED"], "EXECUTION_ROUTE_TRANSITION_INVALID", "Route"); routeState.state = "ACCEPTED"; if (vehicleState) vehicleState.state = "ACCEPTED"; break;
      case "VEHICLE_DEPARTED": {
        requireState(routeState.state, ["ACCEPTED"], "EXECUTION_ROUTE_TRANSITION_INVALID", "Route"); routeState.state = "DEPARTED"; if (vehicleState) vehicleState.state = "DEPARTED";
        const cursor = state.routeCursors[event.routeId]; if (cursor.nextActionableStopId) state.stopStates[cursor.nextActionableStopId].state = "EN_ROUTE"; break;
      }
      case "POSITION_RECORDED":
        requireState(routeState.state, ["DEPARTED", "IN_PROGRESS"], "EXECUTION_ROUTE_TRANSITION_INVALID", "Route");
        if (!text(event.payload?.derivedTelemetryHash) || !["PASS", "WARN"].includes(text(event.payload?.telemetryStatus))) fail("POSITION_TELEMETRY_NOT_VERIFIED", "Position event requires verified DerivedTelemetry.");
        routeState.state = "IN_PROGRESS"; if (vehicleState) { vehicleState.state = "IN_PROGRESS"; vehicleState.coordinate = clone(event.coordinate); vehicleState.roadEdgeId = event.roadEdgeId; } break;
      case "STOP_ARRIVED": requireState(stopState.state, ["EN_ROUTE"], "EXECUTION_STOP_TRANSITION_INVALID", "Stop"); stopState.state = "ARRIVED"; stopState.arrivedAt = event.logicalTime; routeState.activeStopId = event.orderId; break;
      case "SERVICE_STARTED": requireState(stopState.state, ["ARRIVED"], "EXECUTION_SERVICE_START_BEFORE_ARRIVAL", "Stop"); stopState.state = "SERVING"; stopState.serviceStartedAt = event.logicalTime; routeState.activeStopId = event.orderId; break;
      case "SERVICE_COMPLETED": applyTerminal(state, plan, event, "COMPLETED"); break;
      case "STOP_FAILED": applyTerminal(state, plan, event, "FAILED"); break;
      case "STOP_SKIPPED": applyTerminal(state, plan, event, "SKIPPED"); break;
      case "ORDER_CANCELLED": applyTerminal(state, plan, event, "CANCELLED"); break;
      case "DISPATCHER_CANCEL_FUTURE_STOP":
        if (event.source !== "LOCAL_DISPATCHER" || !text(event.payload?.reason)) fail("DISPATCHER_FUTURE_CANCEL_AUTH_REQUIRED", "Future stop cancellation requires dispatcher source and reason.");
        if (stopState.state !== "PENDING" || state.routeCursors[event.routeId].nextActionableStopId === event.orderId) fail("DISPATCHER_FUTURE_CANCEL_INVALID", "Only a future PENDING stop can use dispatcher cancellation.");
        stopState.state = "CANCELLED"; stopState.terminalEventId = event.eventId; routeState.cancelledStopIds.push(event.orderId); Invariants.refreshCursors(state, plan); break;
      case "UNPLANNED_STOP": if (vehicleState) vehicleState.unplannedStopCount = (vehicleState.unplannedStopCount || 0) + 1; break;
      case "OFF_ROUTE_DETECTED": if (vehicleState) vehicleState.offRoute = true; break;
      case "ROUTE_REJOINED": if (vehicleState) vehicleState.offRoute = false; break;
      case "VEHICLE_BREAKDOWN":
        routeState.state = "FAILED"; routeState.activeStopId = "";
        if (vehicleState) { vehicleState.state = "FAILED"; vehicleState.available = false; }
        Object.values(state.stopStates).filter((stop) => stop.routeId === event.routeId && !Invariants.isTerminalStop(stop.state)).forEach((stop) => { stop.state = "FAILED"; stop.terminalEventId = event.eventId; routeState.failedStopIds.push(stop.orderId); });
        Invariants.refreshCursors(state, plan); break;
      case "NETWORK_OFFLINE": state.staleStatus = "OFFLINE_QUEUEING"; break;
      case "NETWORK_RESTORED": state.staleStatus = options.noWebGL ? "LIVE_SIMULATION_NO_WEBGL" : "LIVE_SIMULATION"; break;
      case "EVENT_ACKNOWLEDGED": break;
      case "RUN_COMPLETED": state.run.terminalSummary = Invariants.assertRunCompletion(state); state.run.status = "COMPLETED"; state.staleStatus = "COMPLETED"; break;
      default: fail("EXECUTION_EVENT_TYPE_INVALID", `Unsupported event: ${event.eventType}`);
    }
    if (!RUN_EVENTS.has(event.eventType) && ["RELEASED", "RUNNING"].includes(state.run.status)) state.run.status = "RUNNING";
    Invariants.refreshCursors(state, plan);
    return state;
  }

  function reduce(state, plan, input, options = {}) {
    const beforeHash = state.executionStateHash;
    try {
      const event = normalizeEvent(state.run, input);
      if (event.executionRunHash !== state.run.executionRunHash) fail("EXECUTION_RUN_HASH_MISMATCH", "Event belongs to another execution run.");
      if (event.executionRevision !== Number(state.run.revision)) fail("EXECUTION_REVISION_STALE", "Event execution revision is stale.");
      if (event.payload?.planRevision !== undefined && Number(event.payload.planRevision) !== Number(state.planRevision)) fail("EXECUTION_PLAN_REVISION_STALE", "Event plan revision is stale.");
      if (event.payload?.routeRevision !== undefined && Number(event.payload.routeRevision) !== Number(state.planRevision)) fail("EXECUTION_ROUTE_REVISION_STALE", "Event route revision is stale.");
      const expectedSequence = state.acceptedEvents.length + 1;
      if (event.sequence !== expectedSequence) fail(event.sequence < expectedSequence ? "EXECUTION_SEQUENCE_OUT_OF_ORDER" : "EXECUTION_SEQUENCE_GAP", "Execution event sequence is not the next accepted sequence.", { expectedSequence, actualSequence: event.sequence });
      if (event.logicalTime < state.latestLogicalTime) fail("EXECUTION_LOGICAL_TIME_OUT_OF_ORDER", "Execution event logical time moved backwards.");
      const next = applyEvent(state, plan, event, options);
      next.acceptedEvents.push(clone(event)); next.latestLogicalTime = event.logicalTime; next.executionStateHash = IntegrityHash.hashValue(stateIdentity(next));
      return { status: "ACCEPTED", event, state: next, beforeHash, afterHash: next.executionStateHash };
    } catch (error) {
      return { status: "REJECTED", code: error.code || "EXECUTION_STATE_TRANSITION_INVALID", message: error.message, detail: clone(error.detail || {}), state: clone(state), beforeHash, afterHash: beforeHash };
    }
  }

  function createStore(options = {}) {
    const run = clone(options.run || {}); const plan = clone(options.plan || {});
    if (!text(run.executionRunHash) || !Array.isArray(plan.routes)) fail("EXECUTION_STORE_INPUT_REQUIRED", "Execution Store v1.7 requires a run and plan routes.");
    let state = initialState(run, plan, options); const events = new Map(); const rejectedEvents = [];
    function append(input) {
      const existing = events.get(text(input?.eventId));
      if (existing) {
        let candidate; try { candidate = normalizeEvent(run, input); } catch (error) { return { status: "REJECTED", code: error.code, message: error.message, state: snapshot() }; }
        if (candidate.eventHash === existing.eventHash) return { status: "DUPLICATE_IDEMPOTENT", event: clone(existing), state: snapshot() };
        const conflict = { status: "REJECTED", code: "EXECUTION_EVENT_ID_CONFLICT", eventId: candidate.eventId, state: snapshot() }; rejectedEvents.push(clone(conflict)); return conflict;
      }
      const result = reduce(state, plan, input, options);
      if (result.status === "ACCEPTED") { state = result.state; events.set(result.event.eventId, clone(result.event)); }
      else rejectedEvents.push({ code: result.code, eventId: text(input?.eventId), sequence: input?.sequence, detail: clone(result.detail) });
      return { ...result, state: snapshot() };
    }
    function snapshot() { return clone({ ...state, rejectedEvents }); }
    function exportState() { const body = { schemaVersion: "stct-execution-export-v1.7", run: clone(run), plan: clone(plan), acceptedEvents: clone(state.acceptedEvents), rejectedEvents: clone(rejectedEvents), finalExecutionStateHash: state.executionStateHash, dataClassification: "SYNTHETIC" }; body.exportHash = IntegrityHash.hashValue(body); return body; }
    return { authority: state.authority, append, snapshot, exportState };
  }

  function rebuild(exported, options = {}) {
    Twin.assertSafe(exported);
    if (exported.exportHash && exported.exportHash !== IntegrityHash.hashValue(without(exported, "exportHash"))) fail("EXECUTION_EXPORT_HASH_STALE", "Execution export hash is stale.");
    const store = createStore({ run: exported.run, plan: exported.plan, ...options });
    for (const event of exported.acceptedEvents || []) {
      const result = store.append(event);
      if (result.status !== "ACCEPTED") fail("EXECUTION_IMPORT_EVENT_REJECTED", "Imported execution event was rejected.", result);
    }
    return store;
  }

  return { VERSION, EVENT_TYPES, eventIdentity, createEvent, normalizeEvent, stateIdentity, initialState, applyEvent, reduce, createStore, rebuild };
});
