(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) { root.STCTPlatformV19 = root.STCTPlatformV19 || {}; root.STCTPlatformV19.designRouteMountRegistry = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const SCHEMA_VERSION = "stct-design-route-mount-registry-v1.9-p4";
  const ROUTES = Object.freeze([
    ["design-overview", "/design/overview", "STRATEGIC_OVERVIEW", ["DesignStudyStore", "NetworkAccounting", "OperationalValidationInbox"]],
    ["design-facility-location", "/design/facility-location", "FACILITY_LOCATION_MVP1", ["NetworkContract", "FacilityStudyMvp1", "OR-Tools CP-SAT", "IndependentVerifier", "OperationalValidationBridge"]],
    ["design-supply-chain-study", "/design/supply-chain-study", "SUPPLY_CHAIN_DESIGN", ["SupplyChainImport", "SupplyChainDesign", "SupplyChainReport", "OR-Tools CP-SAT"]],
    ["design-network-scenarios", "/design/network-scenarios", "NETWORK_SCENARIO_STUDIO", ["ScenarioLab", "NetworkSolver", "NetworkVerifier"]],
    ["design-fleet-capacity", "/design/fleet-capacity", "FLEET_CAPACITY_STUDIO", ["NetworkSolver", "NetworkAccounting"]],
    ["design-cost-to-serve", "/design/cost-to-serve", "COST_TO_SERVE_EXPLORER", ["NetworkAccounting", "CandidateEligibility"]],
    ["design-demand-growth", "/design/demand-growth", "DEMAND_GROWTH_STUDIO", ["ScenarioLab", "NetworkVerifier"]],
    ["design-resilience", "/design/resilience", "RESILIENCE_STUDIO", ["ScenarioLab", "NetworkVisualization"]],
    ["design-operational-validation", "/design/operational-validation", "OPERATIONAL_VALIDATION_INBOX", ["DesignStudyStore", "OperationalValidationBridge"]],
  ].map(([routeId, logicalPath, domainKind, requiredCapabilities]) => Object.freeze({ schemaVersion: SCHEMA_VERSION, routeId, logicalPath, domainKind, requiredContext: "DesignStrategicContext", requiredModules: Object.freeze(requiredCapabilities), requiredCapabilities: Object.freeze(requiredCapabilities), mountOwner: `DESIGN:${routeId}`, futureGateBoundaries: Object.freeze(["FACILITY_MVP1_SCOPE_ONLY_NO_P7"]), mount(adapter, context, platformContext) { return adapter.mountDescriptor(this, context, platformContext); }, unmount(adapter) { return adapter.unmount(this.mountOwner); }, snapshot(adapter) { return adapter.snapshot(); }, restore(adapter, snapshot) { return adapter.restore(snapshot); }, fallback() { return "CONTROLLED_ERROR_WITH_PREVIOUS_VALID_ROUTE"; }, noWebGLFallback() { return "COMPLETE_STRATEGIC_TABLE_EQUIVALENT"; }, reducedMotionPolicy() { return "STATIC_RELATIONS_VISIBLE"; }, mobilePolicy() { return "STACKED_STRATEGIC_BANDS"; } })));
  const BY_PATH = new Map(ROUTES.map((route) => [route.logicalPath, route]));
  function createRegistry() { return Object.freeze({ schemaVersion: SCHEMA_VERSION, list: () => ROUTES.slice(), get: (path) => BY_PATH.get(String(path || "")) || null, has: (path) => BY_PATH.has(String(path || "")), diagnostics: () => ({ schemaVersion: SCHEMA_VERSION, routeCount: ROUTES.length, duplicatePaths: ROUTES.filter((route, index) => ROUTES.findIndex((candidate) => candidate.logicalPath === route.logicalPath) !== index).map((route) => route.logicalPath) }) }); }
  return Object.freeze({ SCHEMA_VERSION, ROUTES, createRegistry });
});
