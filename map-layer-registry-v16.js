(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV16 = root.STCTV16 || { version: "1.6.0" }; root.STCTV16.mapLayers = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const VERSION = "stct-map-layer-registry-v1.6";
  const DEFINITIONS = Object.freeze({
    ROAD_NETWORK: [10, "Road graph edges", "map-space", "Road network", "static", "Road edge table"],
    SERVICE_ZONES: [15, "Service-zone polygons", "map-space", "Service zones", "static", "Zone list"],
    ROAD_RESTRICTIONS: [20, "Turn and vehicle restrictions", "map-space", "Restrictions", "static outline", "Restriction table"],
    ROAD_CLOSURES: [25, "Configured road closures", "map-space", "Closures", "static hatch", "Closure list"],
    PLANNED_ROUTE: [30, "Verified planned road route", "map-space", "Planned", "static dashed line", "Planned route summary"],
    ROUTE_MORPH: [35, "Before and after route comparison", "map-space", "Route change", "static before/after", "Before/after table"],
    ACTUAL_ROUTE: [40, "Simulated accepted execution path", "map-space", "Simulated Actual", "step by logical time", "Execution path rows"],
    OFF_ROUTE: [45, "Simulated off-route segments", "map-space", "Off route", "static dash-dot", "Off-route event list"],
    EXECUTION_STOPS: [50, "Planned and simulated stop states", "map-space", "Stops", "state symbols", "Stop status table"],
    CURRENT_VEHICLES: [60, "Current simulated vehicle positions", "screen-stable", "Vehicles", "time-step movement", "Vehicle status list"],
    ALERTS: [70, "Operational alert locations", "screen-stable", "Alerts", "static outline", "Alert inbox"],
    RECOVERY_HANDOVER: [80, "Recovery cutoff and handover", "screen-stable", "Handover", "static marker", "Recovery lineage"],
  });
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  function createRegistry() {
    const layers = new Map();
    function register(id, options = {}) {
      if (!Object.hasOwn(DEFINITIONS, id)) throw Object.assign(new Error(`Unknown v1.6 map layer: ${id}`), { code: "V16_MAP_LAYER_UNKNOWN" });
      if (layers.has(id)) cleanup(id);
      const definition = DEFINITIONS[id]; const value = { id, owner: String(options.owner || "STCTV16"), zIndex: definition[0], dataMeaning: definition[1], coordinateSpace: definition[2], legend: definition[3], reducedMotion: definition[4], noWebGLFallback: definition[5], zoomBehavior: clone(options.zoomBehavior || { min: 0, max: 24, scale: "MAP" }), cleanup: typeof options.cleanup === "function" ? options.cleanup : () => {}, active: true };
      layers.set(id, value); return clone({ ...value, cleanup: undefined });
    }
    function cleanup(id) { const value = layers.get(id); if (!value) return false; try { value.cleanup(); } finally { value.active = false; layers.delete(id); } return true; }
    function cleanupOwner(owner) { const ids = [...layers.values()].filter((value) => value.owner === owner).map((value) => value.id); ids.forEach(cleanup); return { owner, cleaned: ids.length, remaining: layers.size }; }
    function registerAll(owner = "STCTV16", options = {}) { return Object.keys(DEFINITIONS).map((id) => register(id, { owner, cleanup: options.cleanup?.[id], zoomBehavior: options.zoomBehavior?.[id] })); }
    function list() { return [...layers.values()].sort((left, right) => left.zIndex - right.zIndex).map((value) => clone({ ...value, cleanup: undefined })); }
    return { VERSION, DEFINITIONS, register, registerAll, cleanup, cleanupOwner, list, count: () => layers.size };
  }
  return { VERSION, DEFINITIONS, createRegistry };
});
