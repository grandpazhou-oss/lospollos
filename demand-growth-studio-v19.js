(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) { root.STCTPlatformV19 = root.STCTPlatformV19 || {}; root.STCTPlatformV19.demandGrowthStudio = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const csv = (value) => { const source = String(value ?? ""); const safe = /^[\t\r\n ]*[=+\-@]/.test(source) ? `'${source}` : source; return `"${safe.replaceAll('"', '""')}"`; };
  function aggregate(orders, key) { return [...new Set(orders.map((order) => order[key] || "UNCLASSIFIED"))].map((id) => { const rows = orders.filter((order) => (order[key] || "UNCLASSIFIED") === id); return { id, orders: rows.length, volume: rows.reduce((sum, order) => sum + Number(order.demand.volume || 0), 0), weight: rows.reduce((sum, order) => sum + Number(order.demand.weight || 0), 0) }; }); }
  function project(store, filters = {}) {
    const source = store.snapshot();
    const scenario = source.activeRecord.scenario;
    const zoneId = String(filters.zoneId || "ALL");
    const selectedOrders = scenario.orders.filter((order) => zoneId === "ALL" || order.zoneId === zoneId);
    const totals = orders => ({orders:orders.length,volume:orders.reduce((sum,row)=>sum+Number(row.demand.volume||0),0),weight:orders.reduce((sum,row)=>sum+Number(row.demand.weight||0),0)});
    const byZone = aggregate(selectedOrders, "zoneId").map((row) => ({ zoneId: row.id, orders: row.orders, volume: row.volume, weight: row.weight }));
    const byDepot = scenario.depots.map((depot) => { const orders = selectedOrders.filter((order) => order.allowedDepotIds.includes(depot.depotId)); return { depotId: depot.depotId, orders: orders.length, volume: orders.reduce((sum, order) => sum + Number(order.demand.volume || 0), 0), weight: orders.reduce((sum, order) => sum + Number(order.demand.weight || 0), 0) }; });
    const byTaskType = aggregate(selectedOrders, "taskType").map((row) => ({ taskType: row.id, orders: row.orders, volume: row.volume, weight: row.weight }));
    return {
      schemaVersion: "stct-demand-growth-studio-v1.9-p4", inputHash: source.activeInputHash, baselineInputHash: source.baselineInputHash, demandPeriod: source.demandPeriod,
      currentOrders: selectedOrders.length, totalVolume: selectedOrders.reduce((sum, order) => sum + Number(order.demand.volume || 0), 0), totalWeight: selectedOrders.reduce((sum, order) => sum + Number(order.demand.weight || 0), 0),
      growthSemantics: "PER_ORDER_VOLUME_AND_WEIGHT", orderCountChange: 0, before: totals(source.baseline.scenario.orders), after: totals(scenario.orders),
      zones: byZone, byDepot, byTaskType, filters: { zoneId, period: filters.period || source.demandPeriod },
      actions: [
        { id: "DEMAND_10", factor: 1.1, type: "DEMAND_PEAK" }, { id: "DEMAND_25", factor: 1.25, type: "DEMAND_PEAK" }, { id: "DEMAND_50", factor: 1.5, type: "DEMAND_PEAK" },
        { id: "REGIONAL_PEAK", factor: 1.25, type: "DEMAND_PEAK" }, { id: "REGIONAL_DECLINE", factor: .9, type: "DEMAND_PEAK" },
        { id: "TIME_WINDOW_TIGHTEN", type: "TIME_WINDOW_TIGHTEN" }, { id: "SERVICE_PRIORITY_SHIFT", type: "WAVE_POLICY_CHANGE" },
        { id: "RELEASE_TIME_SHIFT", type: "RELEASE_TIME_SHIFT", minutes: 60 },
      ],
      assumptions: source.activeRecord.audit.at(-1) || null, changedInputOnly: true, forecastClaim: false, autoApply: false,
      tableEquivalent: byZone, textMapSummary: `${byZone.length} zones; ${selectedOrders.length} orders`, evaluationImpact: source.evaluation ? { assignment: source.evaluation.accounting.metrics.assignedCount, unassigned: source.evaluation.plan.trip.unassigned.length, service: source.evaluation.accounting.metrics.serviceLevel, vehicles: source.evaluation.plan.trip.tripChains.length, trips: source.evaluation.plan.trip.trips.length, docks: source.evaluation.accounting.metrics.dockCongestion, waves: source.evaluation.plan.waves.waves.length, cost: source.evaluation.accounting.cost.total, carbonKg: source.evaluation.accounting.carbon.totalKg, reasons: source.evaluation.plan.trip.unassigned.map((row) => row.reasonCode || "UNASSIGNED") } : null,
      sourceAuthority: "scenario-lab-v18",
    };
  }
  function create(store, action, zoneId) {
    const factors = { DEMAND_10: 1.1, DEMAND_25: 1.25, DEMAND_50: 1.5, REGIONAL_PEAK: 1.25, REGIONAL_DECLINE: .9 };
    if (factors[action]) return store.createScenario("DEMAND_PEAK", { factor: factors[action], zoneId: ["REGIONAL_PEAK", "REGIONAL_DECLINE"].includes(action) ? zoneId : "" });
    if (action === "TIME_WINDOW_TIGHTEN") return store.createShock(action, { start: "10:00", end: "12:00" });
    if (action === "SERVICE_PRIORITY_SHIFT") return store.createScenario("WAVE_POLICY_CHANGE", { wavePolicy: "SERVICE_PRIORITY" });
    if (action === "RELEASE_TIME_SHIFT") return store.createScenario("RELEASE_TIME_SHIFT", { minutes: 60, zoneId: zoneId || "" });
    throw Object.assign(new Error(project(store).actions.find((row) => row.id === action)?.reason || "Unsupported demand action"), { code: "DESIGN_DEMAND_ACTION_UNSUPPORTED" });
  }
  function toJson(store, filters = {}) { return `${JSON.stringify(project(store, filters), null, 2)}\n`; }
  function toCsv(store, filters = {}) { return `zone_id,orders,volume,weight\n${project(store, filters).zones.map((row) => [row.zoneId, row.orders, row.volume, row.weight].map(csv).join(",")).join("\n")}\n`; }
  return Object.freeze({ project, create, toJson, toCsv });
});
