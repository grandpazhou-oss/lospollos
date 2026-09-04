(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV16 = root.STCTV16 || { version: "1.6.0" }; root.STCTV16.changePenalty = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const VERSION = "stct-change-penalty-v1.6";
  const DEFAULT_WEIGHTS = Object.freeze({ movedOrders: 20, changedVehicles: 30, changedRoutes: 12, resequencedStops: 5, etaShiftTotal: 0.2, etaShiftMax: 0.5, routePrefixChange: 1000, driverDisruption: 25, loadedOrderTransfer: 2000 });
  const text = (value) => String(value ?? "").trim();
  const number = (value, fallback = 0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
  function index(plan) { const map = new Map(); (plan?.routes || []).forEach((route) => (route.orderIds || []).forEach((orderId, position) => map.set(text(orderId), { vehicleId: text(route.vehicleId), routeId: text(route.routeId), position, eta: number(route.etaByOrder?.[orderId]) }))); return map; }
  function calculate(basePlan, candidate, context = {}, configuredWeights = {}) {
    const base = index(basePlan); const next = index(candidate); const weights = { ...DEFAULT_WEIGHTS, ...configuredWeights };
    const orderIds = [...new Set([...base.keys(), ...next.keys()])].sort();
    let movedOrders = 0; let resequencedStops = 0; let etaShiftTotal = 0; let etaShiftMax = 0; let loadedOrderTransfer = 0;
    const changedVehicleIds = new Set(); const changedRouteIds = new Set(); const evidence = [];
    const loaded = new Set((context.loadedOrderAssignments || []).map((row) => text(row.orderId)));
    orderIds.forEach((orderId) => {
      const before = base.get(orderId); const after = next.get(orderId); if (!before || !after) return;
      const vehicleChanged = before.vehicleId !== after.vehicleId; const routeChanged = before.routeId !== after.routeId; const sequenceChanged = before.position !== after.position;
      if (vehicleChanged || routeChanged) movedOrders += 1;
      if (vehicleChanged) { changedVehicleIds.add(before.vehicleId); changedVehicleIds.add(after.vehicleId); }
      if (routeChanged) { changedRouteIds.add(before.routeId); changedRouteIds.add(after.routeId); }
      if (sequenceChanged) resequencedStops += 1;
      const etaShift = Math.abs(after.eta - before.eta); etaShiftTotal += etaShift; etaShiftMax = Math.max(etaShiftMax, etaShift);
      if (loaded.has(orderId) && vehicleChanged) loadedOrderTransfer += 1;
      if (vehicleChanged || routeChanged || sequenceChanged || etaShift) evidence.push({ orderId, before, after, vehicleChanged, routeChanged, sequenceChanged, etaShift });
    });
    const routePrefixChange = (context.fixedRoutePrefixes || []).filter((prefix) => {
      const route = (candidate?.historicalPrefixes || []).find((row) => text(row.routeId) === text(prefix.routeId)); return !route || JSON.stringify(route.stopIds || []) !== JSON.stringify(prefix.stopIds || []);
    }).length;
    const driverDisruption = changedVehicleIds.size;
    const raw = { movedOrders, changedVehicles: changedVehicleIds.size, changedRoutes: changedRouteIds.size, resequencedStops, etaShiftTotal, etaShiftMax, routePrefixChange, driverDisruption, loadedOrderTransfer };
    const rows = Object.entries(raw).map(([id, value]) => ({ id, rawValue: value, weight: number(weights[id]), contribution: value * number(weights[id]), evidence: id === "movedOrders" ? evidence : [] }));
    return { schemaVersion: "stct-change-penalty-v1.6", raw, weights, rows, total: rows.reduce((sum, row) => sum + row.contribution, 0), evidence };
  }
  return { VERSION, DEFAULT_WEIGHTS, calculate };
});
