(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) { root.STCTPlatformV19 = root.STCTPlatformV19 || {}; root.STCTPlatformV19.designQuickFinder = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const cache = new WeakMap();
  const ALLOWED_PATHS = new Set(["/design/overview", "/design/facility-location", "/design/network-scenarios", "/design/fleet-capacity", "/design/cost-to-serve", "/design/demand-growth", "/design/resilience", "/design/operational-validation"]);
  const ALLOWED_QUERY_KEYS = new Set(["depotId", "zoneId", "scenarioId", "vehicleTypeId", "validationId"]);
  function safeTarget(target) {
    const value = new URL(String(target || "/design/overview"), "http://design.local");
    const path = ALLOWED_PATHS.has(value.pathname) ? value.pathname : "/design/overview";
    const query = new URLSearchParams();
    for (const [key, item] of value.searchParams) if (ALLOWED_QUERY_KEYS.has(key)) query.set(key, item.slice(0, 128));
    return `${path}${query.size ? `?${query}` : ""}`;
  }
  function index(store) {
    const source = store.snapshot();
    const cached = cache.get(store);
    if (cached?.revision === source.revision) return cached.rows;
    const scenario = source.activeRecord.scenario;
    const rows = [
      ...scenario.depots.map((depot) => ({ type: "facility", id: depot.depotId, label: depot.name, detail: `${depot.role} · ${depot.dockIds.length} docks`, target: `/design/facility-location?depotId=${encodeURIComponent(depot.depotId)}` })),
      ...scenario.zones.map((zone) => ({ type: "zone", id: zone.zoneId, label: zone.zoneId, detail: `${zone.mode} · ${scenario.orders.filter((order) => order.zoneId === zone.zoneId).length} orders`, target: `/design/demand-growth?zoneId=${encodeURIComponent(zone.zoneId)}` })),
      ...source.history.map((record) => ({ type: "scenario", id: record.scenarioId, label: record.type, detail: record.inputHash.slice(-12), target: `/design/network-scenarios?scenarioId=${encodeURIComponent(record.scenarioId)}` })),
      ...scenario.vehicleTypes.map((type) => ({ type: "vehicle-type", id: type.vehicleTypeId, label: type.vehicleTypeId, detail: `${scenario.vehicles.filter((vehicle) => vehicle.vehicleTypeId === type.vehicleTypeId).length} vehicles`, target: `/design/fleet-capacity?vehicleTypeId=${encodeURIComponent(type.vehicleTypeId)}` })),
      ...((source.evaluation?.plan.trip.trips || []).slice(0, 60).map((trip) => ({ type: "trip", id: trip.tripId, label: trip.tripId, detail: `${trip.vehicleId} · ${trip.orderIds.length} orders`, target: "/design/network-scenarios" }))),
      ...((source.evaluation?.plan.waves.waves || []).slice(0, 30).map((wave) => ({ type: "wave", id: wave.waveId, label: wave.waveId, detail: `${wave.depotId} · ${wave.tripIds.length} trips`, target: "/design/fleet-capacity" }))),
      ...source.validations.map((item) => ({ type: "validation", id: item.validationId, label: item.validationId, detail: `${item.status} · ${item.summary}`, target: "/design/operational-validation" })),
      { type: "study", id: source.studyId, label: source.studyId, detail: `${source.lifecycle} · ${source.studyHash.slice(-12)}`, target: "/design/overview" },
    ];
    const safeRows = rows.map((row) => ({ ...row, target: safeTarget(row.target) }));
    cache.set(store, { revision: source.revision, rows: safeRows });
    return safeRows;
  }
  function search(store, query) { const value = String(query || "").trim().toLowerCase(); return index(store).filter((row) => !value || `${row.type} ${row.id} ${row.label} ${row.detail}`.toLowerCase().includes(value)).slice(0, 50); }
  return Object.freeze({ ALLOWED_PATHS, ALLOWED_QUERY_KEYS, safeTarget, index, search });
});
