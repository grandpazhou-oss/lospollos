(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.workspaceRegistry = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ROUTES = Object.freeze({
    DESIGN: Object.freeze([
      "/design",
      "/design/overview",
      "/design/facility-location",
      "/design/supply-chain-study",
      "/design/network-scenarios",
      "/design/fleet-capacity",
      "/design/cost-to-serve",
      "/design/demand-growth",
      "/design/resilience",
      "/design/operational-validation",
    ]),
    COMMAND: Object.freeze([
      "/command",
      "/command/overview",
      "/command/dispatch",
      "/command/mission-control",
      "/command/execution",
      "/command/plan-vs-actual",
      "/command/driver-simulator",
      "/command/alerts",
      "/command/recovery",
      "/command/shift-review",
      "/command/analysis",
      "/command/cost",
      "/command/carbon",
      "/command/report",
    ]),
    PLATFORM: Object.freeze([
      "/",
      "/platform/data",
      "/platform/scenarios",
      "/platform/trust",
      "/platform/settings",
    ]),
  });

  const DESCRIPTORS = Object.freeze([
    Object.freeze({
      key: "design",
      displayLabelKey: "workspace.design",
      descriptionKey: "workspace.design.description",
      defaultRoute: "/design/overview",
      allowedRoutes: ROUTES.DESIGN,
      mountOwner: "STCTPlatformV19:DESIGN",
      status: "P1_ROUTE_READY_DOMAIN_NOT_MIGRATED",
    }),
    Object.freeze({
      key: "command",
      displayLabelKey: "workspace.command",
      descriptionKey: "workspace.command.description",
      defaultRoute: "/command/overview",
      allowedRoutes: ROUTES.COMMAND,
      mountOwner: "STCTPlatformV19:COMMAND",
      status: "P1_ROUTE_READY_P3_MIGRATION_PENDING",
    }),
    Object.freeze({
      key: "platform",
      displayLabelKey: "workspace.platform",
      descriptionKey: "workspace.platform.description",
      defaultRoute: "/platform/data",
      allowedRoutes: ROUTES.PLATFORM,
      mountOwner: "STCTPlatformV19:PLATFORM",
      status: "P1_ROUTE_READY_SHARED_CAPABILITIES_PENDING",
    }),
  ]);

  function createRegistry() {
    const byKey = new Map(DESCRIPTORS.map((row) => [row.key, row]));
    return Object.freeze({
      get(key) {
        return byKey.get(String(key || "").toLowerCase()) || null;
      },
      all() {
        return DESCRIPTORS.slice();
      },
      workspaceForRoute(logicalPath) {
        return DESCRIPTORS.find((row) => row.allowedRoutes.includes(logicalPath)) || null;
      },
      defaultRoute(workspace) {
        const descriptor = byKey.get(String(workspace || "").toLowerCase());
        return descriptor ? descriptor.defaultRoute : "/";
      },
    });
  }

  return Object.freeze({ ROUTES, DESCRIPTORS, createRegistry });
});
