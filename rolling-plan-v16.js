(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const api = factory(integrity);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV16 = root.STCTV16 || { version: "1.6.0" };
    root.STCTV16.rollingPlan = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash) {
  "use strict";

  if (!IntegrityHash?.hashValue) throw new Error("Rolling Plan v1.6 requires the v1.5.1 SHA-256 utility.");
  const VERSION = "stct-rolling-plan-v1.6";
  const TRANSFER_POLICIES = Object.freeze(["LOCK_LOADED_ORDERS_TO_VEHICLE", "ALLOW_TRANSFER_AT_DEPOT", "VIRTUAL_CROSS_DOCK_SIMULATION"]);
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  const number = (value, fallback = NaN) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
  function fail(code, message, detail = {}) { const error = new Error(message); error.code = code; error.detail = clone(detail); throw error; }
  function unique(values, field, duplicatePolicy = "DEDUPE") {
    const rows = (values || []).map((value) => text(field ? value?.[field] : value)).filter(Boolean);
    if (duplicatePolicy === "REJECT" && new Set(rows).size !== rows.length) fail("ROLLING_DUPLICATE_ID", `Duplicate ${field || "id"}.`, { rows });
    return [...new Set(rows)];
  }
  function coordinate(value) { const pair = [number(value?.lon ?? value?.lng ?? value?.coordinate?.[0] ?? value?.[0]), number(value?.lat ?? value?.coordinate?.[1] ?? value?.[1])]; if (!Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || pair[0] < -180 || pair[0] > 180 || pair[1] < -90 || pair[1] > 90) fail("ROLLING_VEHICLE_COORDINATE_INVALID", "Vehicle current coordinate is invalid.", { value }); return pair; }

  function normalizeVehicleState(value) {
    const vehicleId = text(value?.vehicleId); if (!vehicleId) fail("ROLLING_VEHICLE_ID_REQUIRED", "Rolling vehicleId is required.");
    const currentLogicalMinute = number(value.currentLogicalMinute); const remainingShiftMinutes = number(value.remainingShiftMinutes); const currentLoad = number(value.currentLoad, 0);
    if (!(currentLogicalMinute >= 0)) fail("ROLLING_VEHICLE_TIME_INVALID", `Invalid currentLogicalMinute for ${vehicleId}.`);
    if (!(remainingShiftMinutes >= 0)) fail("ROLLING_REMAINING_SHIFT_INVALID", `Invalid remainingShiftMinutes for ${vehicleId}.`);
    if (!(currentLoad >= 0)) fail("ROLLING_CURRENT_LOAD_INVALID", `Invalid currentLoad for ${vehicleId}.`);
    return {
      vehicleId,
      status: text(value.status || "AVAILABLE"),
      currentLogicalMinute,
      currentCoordinate: coordinate(value.currentCoordinate),
      currentRoadNodeId: text(value.currentRoadNodeId),
      currentLoad,
      completedStopIds: unique(value.completedStopIds || []),
      activeStopId: text(value.activeStopId),
      remainingLoadedOrderIds: unique(value.remainingLoadedOrderIds || []),
      remainingShiftMinutes,
      available: value.available !== false,
      failureReason: text(value.failureReason),
      atDepot: value.atDepot === true,
    };
  }

  function contextIdentity(value) {
    return {
      schemaVersion: "stct-rolling-plan-context-v1.6",
      baseInputHash: value.baseInputHash,
      currentPlanHash: value.currentPlanHash,
      executionRunHash: value.executionRunHash,
      executionStateHash: value.executionStateHash,
      cutoffLogicalMinute: value.cutoffLogicalMinute,
      vehicleStates: value.vehicleStates,
      completedStopIds: value.completedStopIds,
      activeStopIds: value.activeStopIds,
      failedStopIds: value.failedStopIds,
      remainingOrderIds: value.remainingOrderIds,
      cancelledOrderIds: value.cancelledOrderIds,
      loadedOrderAssignments: value.loadedOrderAssignments,
      lockedRouteIds: value.lockedRouteIds,
      fixedRoutePrefixes: value.fixedRoutePrefixes,
      transferPolicy: value.transferPolicy,
      matrixHash: value.matrixHash,
      providerProvenance: value.providerProvenance,
    };
  }

  function normalizeContext(input = {}) {
    const required = ["baseInputHash", "currentPlanHash", "executionRunHash", "executionStateHash", "matrixHash"];
    required.forEach((field) => { if (!text(input[field])) fail(`ROLLING_${field.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}_REQUIRED`, `${field} is required.`); });
    const cutoffLogicalMinute = number(input.cutoffLogicalMinute); if (!(cutoffLogicalMinute >= 0)) fail("ROLLING_CUTOFF_REQUIRED", "cutoffLogicalMinute is required and must be non-negative.");
    const completedStopIds = unique(input.completedStopIds || []); const activeStopIds = unique(input.activeStopIds || []); const failedStopIds = unique(input.failedStopIds || []); const remainingOrderIds = unique(input.remainingOrderIds || []); const cancelledOrderIds = unique(input.cancelledOrderIds || []);
    const completed = new Set(completedStopIds);
    if (activeStopIds.some((id) => completed.has(id))) fail("ROLLING_ACTIVE_COMPLETED_CONFLICT", "An active stop cannot also be completed.");
    if (remainingOrderIds.some((id) => completed.has(id))) fail("ROLLING_REMAINING_COMPLETED_CONFLICT", "A completed stop cannot remain in the planning set.");
    const vehicleStates = (input.vehicleStates || []).map(normalizeVehicleState); unique(vehicleStates, "vehicleId", "REJECT");
    const transferPolicy = text(input.transferPolicy || "LOCK_LOADED_ORDERS_TO_VEHICLE");
    if (!TRANSFER_POLICIES.includes(transferPolicy)) fail("ROLLING_TRANSFER_POLICY_INVALID", `Unsupported transfer policy: ${transferPolicy}`);
    const loadedOrderAssignments = (input.loadedOrderAssignments || []).map((row) => ({ orderId: text(row.orderId), vehicleId: text(row.vehicleId), loaded: row.loaded !== false })).filter((row) => row.orderId && row.vehicleId).sort((a, b) => a.orderId.localeCompare(b.orderId, "en"));
    if (new Set(loadedOrderAssignments.map((row) => row.orderId)).size !== loadedOrderAssignments.length) fail("ROLLING_LOADED_ASSIGNMENT_DUPLICATE", "Loaded order assignments must be unique by orderId.");
    const fixedRoutePrefixes = (input.fixedRoutePrefixes || []).map((row) => ({ routeId: text(row.routeId), vehicleId: text(row.vehicleId), stopIds: unique(row.stopIds || []) })).filter((row) => row.routeId && row.vehicleId);
    const value = {
      schemaVersion: "stct-rolling-plan-context-v1.6",
      baseInputHash: text(input.baseInputHash),
      currentPlanHash: text(input.currentPlanHash),
      executionRunHash: text(input.executionRunHash),
      executionStateHash: text(input.executionStateHash),
      cutoffLogicalMinute,
      vehicleStates,
      completedStopIds,
      activeStopIds,
      failedStopIds,
      remainingOrderIds,
      cancelledOrderIds,
      loadedOrderAssignments,
      lockedRouteIds: unique(input.lockedRouteIds || []),
      fixedRoutePrefixes,
      transferPolicy,
      matrixHash: text(input.matrixHash),
      providerProvenance: clone(input.providerProvenance || {}),
    };
    value.contextHash = IntegrityHash.hashValue(contextIdentity(value));
    return value;
  }

  function transferBoundary(policy) {
    if (policy === "VIRTUAL_CROSS_DOCK_SIMULATION") return { policy, label: "Virtual transfer assumption", boundary: "Not an executed physical operation", simulationOnly: true };
    if (policy === "ALLOW_TRANSFER_AT_DEPOT") return { policy, label: "Transfer at depot only", boundary: "Loaded orders may transfer only after simulated depot return", simulationOnly: true };
    return { policy, label: "Loaded orders locked to vehicle", boundary: "Loaded orders cannot change vehicle", simulationOnly: false };
  }

  function scenarioIdentity(value) {
    const semantic = clone(value); delete semantic.inputHash; delete semantic.contentHash; delete semantic.generatedAt; return semantic;
  }

  function deriveRemainingScenario(baseScenario, contextInput, options = {}) {
    const context = normalizeContext(contextInput); const byOrder = new Map((baseScenario?.orders || []).map((order) => [text(order.id || order.orderId), order])); const byVehicle = new Map((baseScenario?.vehicles || []).map((vehicle) => [text(vehicle.id || vehicle.vehicleId), vehicle]));
    const completed = new Set(context.completedStopIds); const cancelled = new Set(context.cancelledOrderIds); const failed = new Set(context.failedStopIds); const remainingSet = new Set(context.remainingOrderIds);
    const expectedRemaining = [...byOrder.keys()].filter((id) => !completed.has(id) && !cancelled.has(id) && (!failed.has(id) || options.failedStopPolicy === "RETRY"));
    if (expectedRemaining.some((id) => !remainingSet.has(id)) || [...remainingSet].some((id) => !expectedRemaining.includes(id))) fail("ROLLING_REMAINING_CONSERVATION_FAIL", "remainingOrderIds do not conserve the base scenario.", { expectedRemaining, actual: [...remainingSet] });
    const loadedByOrder = new Map(context.loadedOrderAssignments.map((row) => [row.orderId, row.vehicleId]));
    const active = new Set(context.activeStopIds);
    const orders = expectedRemaining.map((orderId) => {
      const order = byOrder.get(orderId); if (!order) fail("ROLLING_ORDER_NOT_FOUND", `Unknown remaining order: ${orderId}`);
      return { ...clone(order), id: orderId, activeService: active.has(orderId), fixedVehicleId: loadedByOrder.get(orderId) || "", cancelled: false, failedRetry: failed.has(orderId) };
    });
    const vehicles = context.vehicleStates.map((state) => {
      const base = byVehicle.get(state.vehicleId); if (!base) fail("ROLLING_VEHICLE_NOT_FOUND", `Unknown rolling vehicle: ${state.vehicleId}`);
      const available = state.available && state.status !== "FAILED";
      return {
        ...clone(base),
        id: state.vehicleId,
        vehicleId: state.vehicleId,
        available,
        startPointId: state.currentRoadNodeId || `CURRENT-${state.vehicleId}`,
        endPointId: text(options.endPointByVehicle?.[state.vehicleId] || base.endPointId || baseScenario.depot?.id || "DEPOT"),
        currentCoordinate: clone(state.currentCoordinate),
        startMinute: context.cutoffLogicalMinute,
        remainingShiftMinutes: state.remainingShiftMinutes,
        endMinute: context.cutoffLogicalMinute + state.remainingShiftMinutes,
        currentLoad: state.currentLoad,
        activeStopId: state.activeStopId,
        remainingLoadedOrderIds: clone(state.remainingLoadedOrderIds),
        failureReason: state.failureReason,
        atDepot: state.atDepot,
      };
    });
    const scenario = {
      schemaVersion: "stct-derived-remaining-scenario-v1.6",
      scenarioId: text(options.scenarioId || `${text(baseScenario?.scenarioId || "SCENARIO")}-ROLLING-${context.cutoffLogicalMinute}`),
      baseScenarioId: text(baseScenario?.scenarioId),
      baseInputHash: context.baseInputHash,
      contextHash: context.contextHash,
      planningDate: text(baseScenario?.planningDate),
      depot: clone(baseScenario?.depot || {}),
      orders,
      vehicles,
      completedStopIds: clone(context.completedStopIds),
      activeStopIds: clone(context.activeStopIds),
      failedStopIds: clone(context.failedStopIds),
      cancelledOrderIds: clone(context.cancelledOrderIds),
      historicalPrefixes: clone(context.fixedRoutePrefixes),
      lockedRouteIds: clone(context.lockedRouteIds),
      loadedOrderAssignments: clone(context.loadedOrderAssignments),
      transferPolicy: context.transferPolicy,
      transferBoundary: transferBoundary(context.transferPolicy),
      matrixHash: context.matrixHash,
      providerProvenance: clone(context.providerProvenance),
      cutoffLogicalMinute: context.cutoffLogicalMinute,
      constraints: clone(baseScenario?.constraints || {}),
      assumptions: { ...(clone(baseScenario?.assumptions || {})), roadMatrixAuthoritative: true, noHaversineSubstitution: true },
      generatedAt: text(options.generatedAt || "1970-01-01T00:00:00.000Z"),
    };
    scenario.inputHash = IntegrityHash.hashValue(scenarioIdentity(scenario));
    scenario.contentHash = scenario.inputHash;
    return scenario;
  }

  function routeAssignments(plan) {
    const result = new Map();
    (plan?.routes || []).forEach((route) => (route.orderIds || []).forEach((orderId, index) => result.set(text(orderId), { vehicleId: text(route.vehicleId), routeId: text(route.routeId), index })));
    return result;
  }

  function pinningIdentity(contextInput) {
    const context = normalizeContext(contextInput);
    return { completedStopIds: context.completedStopIds, activeStopIds: context.activeStopIds, loadedOrderAssignments: context.loadedOrderAssignments, lockedRouteIds: context.lockedRouteIds, fixedRoutePrefixes: context.fixedRoutePrefixes, transferPolicy: context.transferPolicy };
  }

  function verifyCandidate(candidate, contextInput) {
    const context = normalizeContext(contextInput); const violations = []; const assignments = routeAssignments(candidate);
    const candidatePrefixes = new Map((candidate?.historicalPrefixes || []).map((row) => [text(row.routeId), row]));
    context.fixedRoutePrefixes.forEach((prefix) => {
      const actual = candidatePrefixes.get(prefix.routeId);
      if (!actual || actual.vehicleId !== prefix.vehicleId || JSON.stringify(actual.stopIds || []) !== JSON.stringify(prefix.stopIds)) violations.push({ code: "COMPLETED_PREFIX_CHANGED", routeId: prefix.routeId });
    });
    context.activeStopIds.forEach((orderId) => {
      const assignment = assignments.get(orderId);
      if (!assignment || assignment.index !== 0) violations.push({ code: "ACTIVE_STOP_MOVED", orderId });
    });
    context.loadedOrderAssignments.forEach((loaded) => {
      const assignment = assignments.get(loaded.orderId); if (!assignment) return;
      const vehicleState = context.vehicleStates.find((row) => row.vehicleId === loaded.vehicleId);
      const transferAllowed = context.transferPolicy === "VIRTUAL_CROSS_DOCK_SIMULATION" || context.transferPolicy === "ALLOW_TRANSFER_AT_DEPOT" && vehicleState?.atDepot;
      if (assignment.vehicleId !== loaded.vehicleId && !transferAllowed) violations.push({ code: "LOADED_ORDER_TRANSFER", orderId: loaded.orderId, expectedVehicleId: loaded.vehicleId, actualVehicleId: assignment.vehicleId });
    });
    context.lockedRouteIds.forEach((routeId) => {
      const expected = context.fixedRoutePrefixes.find((row) => row.routeId === routeId); const route = (candidate?.routes || []).find((row) => text(row.routeId) === routeId);
      if (expected && (!route || text(route.vehicleId) !== expected.vehicleId)) violations.push({ code: "LOCKED_ROUTE_CHANGED", routeId });
    });
    const pinningHash = IntegrityHash.hashValue(pinningIdentity(context));
    return { status: violations.length ? "FAIL" : "PASS", violations, pinningHash, capability: { nativeSolverPinning: false, enforcement: "DERIVED_SCENARIO_PLUS_POST_VERIFIER" } };
  }

  return { VERSION, TRANSFER_POLICIES, contextIdentity, normalizeContext, transferBoundary, scenarioIdentity, deriveRemainingScenario, routeAssignments, pinningIdentity, verifyCandidate };
});
