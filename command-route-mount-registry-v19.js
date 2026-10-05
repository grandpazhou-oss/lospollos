(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.commandRouteMountRegistry = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = "stct-command-route-mount-registry-v1.9-p3";
  const ROUTES = Object.freeze([
    ["command-analysis", "/command/analysis", "TRANSPORT_ANALYSIS", ["Planning"], ["planningState"]],
    ["command-cost", "/command/cost", "TRANSPORT_COST", ["Planning"], ["planningState"]],
    ["command-carbon", "/command/carbon", "TRANSPORT_CARBON", ["Planning"], ["planningState"]],
    ["command-report", "/command/report", "TRANSPORT_REPORT", ["Planning"], ["planningState"]],
    ["command-overview", "/command/overview", "OPERATIONS_COCKPIT", ["OperationsWorkspace", "ExecutionStore", "AlertStore"], ["operationsWorkspace", "executionStore", "alertStore"]],
    ["command-dispatch", "/command/dispatch", "DISPATCH_WORKBENCH", ["CanonicalScenario", "Planning", "Verifier"], ["planningState", "canonicalScenario", "verifier"]],
    ["command-mission-control", "/command/mission-control", "MISSION_CONTROL", ["SimulationStore", "FleetReplay", "MapLayerRegistry"], ["simulationStore", "replayController", "mapLayerRegistry"]],
    ["command-execution", "/command/execution", "EXECUTION_CONTROL", ["ExecutionRun", "ExecutionStore", "DerivedTelemetry"], ["executionStore", "derivedTelemetry"]],
    ["command-plan-vs-actual", "/command/plan-vs-actual", "PLAN_VS_ACTUAL", ["MultiVehiclePlanActual", "DerivedTelemetry"], ["executionStore", "planActualProjection"]],
    ["command-driver-simulator", "/command/driver-simulator", "DRIVER_SIMULATOR", ["DriverLocalProjection", "OfflineQueue", "ExecutionStore"], ["driverSimulator", "offlineQueue", "executionStore"]],
    ["command-alerts", "/command/alerts", "ALERT_INBOX", ["AlertStore", "Incident"], ["alertStore", "incidentReferences"]],
    ["command-recovery", "/command/recovery", "RECOVERY_WORKBENCH", ["RollingRecovery", "Verifier", "ConfiguredEngine"], ["recoverySession", "candidatePool", "engineBoundary"]],
    ["command-shift-review", "/command/shift-review", "SHIFT_REVIEW", ["ShiftReview", "FlightRecorder", "ExecutionStore"], ["shiftReviewProjection", "flightRecorder", "executionStore"]],
  ].map(([routeId, logicalPath, domainKind, requiredCapabilities, requiredStores]) => Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    routeId,
    logicalPath,
    domainKind,
    mountOwner: `COMMAND:${routeId}`,
    requiredCapabilities: Object.freeze(requiredCapabilities),
    requiredStores: Object.freeze(requiredStores),
    mount(adapter, context, platformContext) { return adapter.mountDescriptor(this, context, platformContext); },
    unmount(adapter) { return adapter.unmount(this.mountOwner); },
    snapshot(adapter) { return adapter.snapshot(); },
    restore(adapter, snapshot) { return adapter.restore(snapshot); },
    noWebGLFallback() { return "COMPLETE_OPERATIONAL_TABLE_EQUIVALENT"; },
    reducedMotionPolicy() { return "STATIC_BY_DEFAULT_NO_AUTO_PLAY"; },
    mobilePolicy() { return "PRIORITY_LIST_WITH_DETAIL_SHEET"; },
  })));
  const BY_PATH = new Map(ROUTES.map((descriptor) => [descriptor.logicalPath, descriptor]));

  function createRegistry() {
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      list: () => ROUTES.slice(),
      get(path) { return BY_PATH.get(String(path || "")) || null; },
      has(path) { return BY_PATH.has(String(path || "")); },
      diagnostics() {
        return {
          schemaVersion: SCHEMA_VERSION,
          routeCount: ROUTES.length,
          duplicatePaths: ROUTES.filter((row, index) => ROUTES.findIndex((candidate) => candidate.logicalPath === row.logicalPath) !== index).map((row) => row.logicalPath),
          missingContracts: ROUTES.filter((row) => ["mount", "unmount", "snapshot", "restore", "noWebGLFallback", "reducedMotionPolicy", "mobilePolicy"].some((key) => typeof row[key] !== "function")).map((row) => row.logicalPath),
        };
      },
    });
  }

  return Object.freeze({ SCHEMA_VERSION, ROUTES, createRegistry });
});
