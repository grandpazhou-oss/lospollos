(function (root, factory) {
  "use strict";
  const isolation = typeof module === "object" && module.exports
    ? require("./workspace-state-isolation-v19.js")
    : root.STCTPlatformV19.workspaceIsolation;
  const api = factory(isolation);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.navigationModel = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Isolation) {
  "use strict";

  function item(path, labelKey, icon) {
    return Object.freeze({ path, labelKey, icon });
  }

  const BUSINESS_GROUPS = Object.freeze({
    DESIGN: Object.freeze([
      Object.freeze({ labelKey: "group.network", items: Object.freeze([
        item("/design/overview", "route.design.overview", "⌂"),
        item("/design/facility-location", "route.design.facility", "◇"),
        item("/design/supply-chain-study", "route.design.supply", "▦"),
        item("/design/network-scenarios", "route.design.scenarios", "↗"),
      ]) }),
      Object.freeze({ labelKey: "group.planning", items: Object.freeze([
        item("/design/fleet-capacity", "route.design.fleet", "▤"),
        item("/design/cost-to-serve", "route.design.cost", "$"),
        item("/design/demand-growth", "route.design.demand", "↟"),
        item("/design/resilience", "route.design.resilience", "◎"),
      ]) }),
      Object.freeze({ labelKey: "group.validate", items: Object.freeze([
        item("/design/operational-validation", "route.design.validation", "✓"),
      ]) }),
    ]),
    COMMAND: Object.freeze([
      Object.freeze({ labelKey: "group.operations", items: Object.freeze([
        item("/command/overview", "route.command.overview", "⌂"),
        item("/command/dispatch", "route.command.dispatch", "⌁"),
        item("/command/mission-control", "route.command.mission", "◉"),
      ]) }),
      Object.freeze({ labelKey: "group.execution", items: Object.freeze([
        item("/command/execution", "route.command.execution", "▶"),
        item("/command/plan-vs-actual", "route.command.actual", "⇄"),
        item("/command/driver-simulator", "route.command.driver", "▱"),
      ]) }),
      Object.freeze({ labelKey: "group.response", items: Object.freeze([
        item("/command/alerts", "route.command.alerts", "!"),
        item("/command/recovery", "route.command.recovery", "↶"),
        item("/command/shift-review", "route.command.shift", "▦"),
      ]) }),
    ]),
  });

  const PLATFORM_ITEMS = Object.freeze([
    item("/platform/data", "route.platform.data", "▥"),
    item("/platform/scenarios", "route.platform.scenarios", "▦"),
    item("/platform/trust", "route.platform.trust", "✓"),
    item("/platform/settings", "route.platform.settings", "⚙"),
  ]);

  const WORKSPACE_IDENTITIES = Object.freeze({
    DESIGN: Object.freeze({ key: "DESIGN", icon: "◇", subtitleKey: "workspace.design.short", descriptionKey: "workspace.design.subtitle" }),
    COMMAND: Object.freeze({ key: "COMMAND", icon: "≋", subtitleKey: "workspace.command.short", descriptionKey: "workspace.command.subtitle" }),
  });

  function indexRoutes(routes) {
    return new Map((routes || []).map((route) => [route.logicalPath, route]));
  }

  function buildNavigationModel(snapshot, routes) {
    const routeIndex = indexRoutes(routes);
    const businessWorkspace = Isolation.rememberedBusinessWorkspace(snapshot);
    const businessGroups = BUSINESS_GROUPS[businessWorkspace].map((group) => ({
      labelKey: group.labelKey,
      items: group.items.map((navItem) => Object.assign({}, navItem, { descriptor: routeIndex.get(navItem.path) || null })),
    }));
    const platformItems = PLATFORM_ITEMS.map((navItem) => Object.assign({}, navItem, { descriptor: routeIndex.get(navItem.path) || null }));
    return {
      activeWorkspace: snapshot.activeWorkspace,
      businessWorkspace,
      activeRoute: snapshot.activeRoute,
      isHome: snapshot.activeRoute === "/",
      collapsed: snapshot.navigationCollapsed,
      drawerOpen: snapshot.mobileDrawerOpen,
      locale: snapshot.locale,
      reducedMotion: snapshot.reducedMotion,
      noWebGL: snapshot.noWebGL,
      identity: WORKSPACE_IDENTITIES[businessWorkspace],
      businessGroups,
      platformGroup: { labelKey: "group.platform", items: platformItems },
    };
  }

  function validateAgainstRoutes(routes) {
    const routeIndex = indexRoutes(routes);
    const expected = [...Object.values(BUSINESS_GROUPS).flatMap((groups) => groups.flatMap((group) => group.items)), ...PLATFORM_ITEMS];
    const missing = expected.filter((navItem) => !routeIndex.has(navItem.path)).map((navItem) => navItem.path);
    return { ok: missing.length === 0, missing, routeCount: expected.length };
  }

  return Object.freeze({ BUSINESS_GROUPS, PLATFORM_ITEMS, WORKSPACE_IDENTITIES, buildNavigationModel, validateAgainstRoutes });
});
