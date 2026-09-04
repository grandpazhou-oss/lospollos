(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV17 = root.STCTV17 || { version: "1.7.0" }; root.STCTV17.executionInvariants = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "stct-execution-invariants-v1.7";
  const STOP_TERMINAL = Object.freeze(["COMPLETED", "FAILED", "SKIPPED", "CANCELLED"]);
  const ROUTE_TERMINAL = Object.freeze(["COMPLETED", "COMPLETED_WITH_EXCEPTIONS", "FAILED", "CANCELLED"]);
  const RUN_TERMINAL = Object.freeze(["COMPLETED", "CANCELLED"]);
  const RUN_STATUSES = Object.freeze(["PREPARED", "RELEASED", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED"]);
  const BUSINESS_EVENTS = Object.freeze([
    "ROUTE_ACCEPTED", "VEHICLE_DEPARTED", "POSITION_RECORDED", "STOP_ARRIVED", "SERVICE_STARTED",
    "SERVICE_COMPLETED", "STOP_FAILED", "STOP_SKIPPED", "ORDER_CANCELLED", "DISPATCHER_CANCEL_FUTURE_STOP",
    "UNPLANNED_STOP", "OFF_ROUTE_DETECTED", "ROUTE_REJOINED", "VEHICLE_BREAKDOWN",
  ]);
  const COPY = Object.freeze({
    zh: {
      RUN_COMPLETION_INVARIANT_FAILED: "仍有未终态路线、配送点、服务或离线冲突，班次不能完成。",
      EXECUTION_STOP_NOT_ACTIONABLE: "只能操作当前或已激活的配送点。",
      EXECUTION_RUN_TERMINAL: "班次已结束，不能再接受业务事件。",
    },
    en: {
      RUN_COMPLETION_INVARIANT_FAILED: "The run cannot complete while routes, stops, services, or offline conflicts remain non-terminal.",
      EXECUTION_STOP_NOT_ACTIONABLE: "Only the current or active stop can accept this action.",
      EXECUTION_RUN_TERMINAL: "A terminal run cannot accept another business event.",
    },
    ja: {
      RUN_COMPLETION_INVARIANT_FAILED: "未完了のルート、配送先、サービス、またはオフライン競合があるため運行を完了できません。",
      EXECUTION_STOP_NOT_ACTIONABLE: "現在または処理中の配送先だけを操作できます。",
      EXECUTION_RUN_TERMINAL: "終了した運行は新しい業務イベントを受け付けません。",
    },
  });

  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  function fail(code, message, detail = {}) { const error = new Error(message); error.code = code; error.detail = clone(detail); throw error; }
  function isTerminalStop(state) { return STOP_TERMINAL.includes(text(state)); }
  function isTerminalRoute(state) { return ROUTE_TERMINAL.includes(text(state)); }
  function routeOrder(plan, routeId) { return clone((plan?.routes || []).find((route) => text(route.routeId) === text(routeId))?.orderIds || []); }

  function cursorFor(state, plan, routeId) {
    const orderIds = routeOrder(plan, routeId);
    const routeState = state.routeStates?.[routeId];
    const firstActionableIndex = orderIds.findIndex((orderId) => !isTerminalStop(state.stopStates?.[orderId]?.state));
    const activeStopId = text(routeState?.activeStopId);
    return {
      schemaVersion: "stct-route-execution-cursor-v1.7",
      routeId,
      currentStopIndex: firstActionableIndex,
      activeStopId,
      nextActionableStopId: firstActionableIndex >= 0 ? orderIds[firstActionableIndex] : "",
      terminalStopIds: orderIds.filter((orderId) => isTerminalStop(state.stopStates?.[orderId]?.state)),
    };
  }

  function refreshCursors(state, plan) {
    const cursors = {};
    for (const route of plan?.routes || []) cursors[route.routeId] = cursorFor(state, plan, route.routeId);
    state.routeCursors = cursors;
    return state;
  }

  function assertAssociation(state, event) {
    if (!event.routeId) return;
    const route = state.routeStates?.[event.routeId];
    if (!route) fail("EXECUTION_ROUTE_NOT_FOUND", `Unknown route: ${event.routeId}`, { routeId: event.routeId });
    if (event.vehicleId && route.vehicleId !== event.vehicleId) fail("EXECUTION_ROUTE_VEHICLE_MISMATCH", "Event vehicle does not own the route.", { routeId: event.routeId, expected: route.vehicleId, actual: event.vehicleId });
    if (event.orderId) {
      const stop = state.stopStates?.[event.orderId];
      if (!stop) fail("EXECUTION_STOP_NOT_FOUND", `Unknown stop: ${event.orderId}`, { orderId: event.orderId });
      if (stop.routeId !== event.routeId) fail("EXECUTION_STOP_ROUTE_MISMATCH", "Event stop does not belong to the route.", { orderId: event.orderId, expected: stop.routeId, actual: event.routeId });
      if (event.vehicleId && stop.vehicleId !== event.vehicleId) fail("EXECUTION_STOP_VEHICLE_MISMATCH", "Event vehicle does not own the stop.", { orderId: event.orderId, expected: stop.vehicleId, actual: event.vehicleId });
    }
  }

  function assertActionableStop(state, event) {
    if (!event.orderId || event.eventType === "DISPATCHER_CANCEL_FUTURE_STOP") return;
    const cursor = state.routeCursors?.[event.routeId];
    const allowed = new Set([cursor?.nextActionableStopId, cursor?.activeStopId].filter(Boolean));
    if (!allowed.has(event.orderId)) fail("EXECUTION_STOP_NOT_ACTIONABLE", "Only the current or active stop can accept this action.", { orderId: event.orderId, nextActionableStopId: cursor?.nextActionableStopId || "", activeStopId: cursor?.activeStopId || "" });
  }

  function completionDiagnostics(state) {
    const nonTerminalRoutes = Object.values(state.routeStates || {}).filter((route) => !isTerminalRoute(route.state)).map((route) => route.routeId);
    const nonTerminalStops = Object.values(state.stopStates || {}).filter((stop) => !isTerminalStop(stop.state)).map((stop) => stop.orderId);
    const activeServices = Object.values(state.stopStates || {}).filter((stop) => ["ARRIVED", "SERVING"].includes(stop.state)).map((stop) => stop.orderId);
    const pendingQueueConflicts = clone(state.pendingQueueConflicts || []);
    return { nonTerminalRoutes, nonTerminalStops, activeServices, pendingQueueConflicts };
  }

  function assertRunCompletion(state) {
    const detail = completionDiagnostics(state);
    if (Object.values(detail).some((rows) => rows.length)) fail("RUN_COMPLETION_INVARIANT_FAILED", "Run completion invariant failed.", detail);
    return detail;
  }

  return {
    VERSION, STOP_TERMINAL, ROUTE_TERMINAL, RUN_TERMINAL, RUN_STATUSES, BUSINESS_EVENTS, COPY,
    isTerminalStop, isTerminalRoute, routeOrder, cursorFor, refreshCursors, assertAssociation,
    assertActionableStop, completionDiagnostics, assertRunCompletion,
  };
});
