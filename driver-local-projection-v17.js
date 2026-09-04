(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const reducer = root?.STCTV17?.executionReducer || (typeof require === "function" ? require("./execution-reducer-v17.js") : null);
  const api = factory(integrity, reducer);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV17 = root.STCTV17 || { version: "1.7.0" }; root.STCTV17.driverLocalProjection = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash, Reducer) {
  "use strict";
  if (!IntegrityHash?.hashValue || !Reducer?.reduce) throw new Error("Local Driver Projection v1.7 dependencies are missing.");

  const VERSION = "stct-driver-local-projection-v1.7";
  const TERMINAL = new Set(["COMPLETED", "FAILED", "SKIPPED", "CANCELLED"]);
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  function identity(value) {
    return {
      schemaVersion: value.schemaVersion,
      baseExecutionStateHash: value.baseExecutionStateHash,
      baseSequence: value.baseSequence,
      pendingEventHashes: value.pendingEvents.map((item) => item.event.eventHash),
      projectedRouteStates: value.projectedRouteStates,
      projectedStopStates: value.projectedStopStates,
      projectedVehicleStates: value.projectedVehicleStates,
      projectedRouteCursors: value.projectedRouteCursors,
      projectedExecutionStateHash: value.projectedExecutionStateHash,
      conflicts: value.conflicts,
    };
  }

  function rebuild(options = {}) {
    const authoritativeState = clone(options.authoritativeState || {}); const plan = clone(options.plan || {});
    const pendingEvents = clone(options.pendingEvents || []).filter((item) => !["ACKED", "DISCARDED"].includes(item.status)).sort((a, b) => Number(a.localSequence) - Number(b.localSequence));
    let projected = { ...authoritativeState, authority: "LOCAL_DRIVER_PROJECTION_V17", rejectedEvents: clone(authoritativeState.rejectedEvents || []) };
    const conflicts = [];
    for (const item of pendingEvents) {
      const projectedEvent = Reducer.createEvent(projected.run, {
        ...item.event,
        sequence: (projected.acceptedEvents?.length || 0) + 1,
        authoritativeEventId: "",
        authoritativeSequence: null,
      });
      const result = Reducer.reduce(projected, plan, projectedEvent, { mode: "LOCAL_PROJECTION", noWebGL: options.noWebGL === true });
      if (result.status === "ACCEPTED") projected = { ...result.state, authority: "LOCAL_DRIVER_PROJECTION_V17" };
      else conflicts.push({ clientEventId: item.clientEventId, eventId: item.event.eventId, code: result.code, dependsOn: clone(item.dependsOn || []), dependencyChain: clone(item.dependencyChain || []), source: "LOCAL_PROJECTION_REPLAY" });
      if (["CONFLICT", "PERMANENT_FAILURE", "BLOCKED_DEPENDENCY"].includes(item.status)) conflicts.push({ clientEventId: item.clientEventId, eventId: item.event.eventId, code: item.errorCode || item.status, dependsOn: clone(item.dependsOn || []), dependencyChain: clone(item.dependencyChain || []), source: "RECONCILIATION" });
    }
    const projection = {
      schemaVersion: "stct-local-driver-projection-v1.7",
      authority: "LOCAL_DRIVER_PROJECTION_V17",
      baseExecutionStateHash: text(authoritativeState.executionStateHash),
      baseSequence: authoritativeState.acceptedEvents?.length || 0,
      pendingEvents,
      projectedRouteStates: clone(projected.routeStates || {}),
      projectedStopStates: clone(projected.stopStates || {}),
      projectedVehicleStates: clone(projected.vehicleStates || {}),
      projectedRouteCursors: clone(projected.routeCursors || {}),
      projectedRun: clone(projected.run || {}),
      projectedLatestLogicalTime: projected.latestLogicalTime,
      projectedExecutionStateHash: text(projected.executionStateHash),
      conflicts,
      projectionHash: "",
    };
    projection.projectionHash = IntegrityHash.hashValue(identity(projection));
    return projection;
  }

  function legalActions(projection, options = {}) {
    const vehicleId = text(options.vehicleId); const route = Object.values(projection.projectedRouteStates || {}).find((row) => !vehicleId || row.vehicleId === vehicleId);
    const cursor = route ? projection.projectedRouteCursors?.[route.routeId] : null; const stop = cursor?.nextActionableStopId ? projection.projectedStopStates?.[cursor.nextActionableStopId] : null;
    return {
      source: "LOCAL_PROJECTION",
      routeId: route?.routeId || "",
      vehicleId: route?.vehicleId || vehicleId,
      currentStopId: stop?.orderId || "",
      acceptRoute: route?.state === "RELEASED",
      depart: route?.state === "ACCEPTED",
      arrive: ["DEPARTED", "IN_PROGRESS"].includes(route?.state) && stop?.state === "EN_ROUTE",
      startService: stop?.state === "ARRIVED",
      complete: stop?.state === "SERVING",
      fail: ["EN_ROUTE", "ARRIVED", "SERVING"].includes(stop?.state),
      skip: ["EN_ROUTE", "ARRIVED", "SERVING"].includes(stop?.state),
      completeRun: Object.values(projection.projectedStopStates || {}).every((row) => TERMINAL.has(row.state)) && projection.conflicts.length === 0,
    };
  }

  return { VERSION, identity, rebuild, legalActions, reducerVersion: Reducer.VERSION };
});
