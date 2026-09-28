(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) { root.STCTPlatformV19 = root.STCTPlatformV19 || {}; root.STCTPlatformV19.networkBaselineExplorer = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const csv = (value) => { const source = String(value ?? ""); const safe = /^[\t\r\n ]*[=+\-@]/.test(source) ? `'${source}` : source; return `"${safe.replaceAll('"', '""')}"`; };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const percentile = (values, ratio) => values.length ? values.slice().sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor((values.length - 1) * ratio))] : null;
  function project(store, filters = {}) {
    const source = store.snapshot();
    const scenario = source.activeRecord.scenario;
    const evaluation = source.evaluation;
    const depotUtilization = new Map((evaluation?.accounting.metrics.depotUtilization || []).map((row) => [row.depotId, row]));
    const routeDistances = (evaluation?.visual.layers.tripRoutes || []).map((row) => Number(row.properties?.distanceKm || 0)).filter((value) => Number.isFinite(value));
    const role = String(filters.role || "ALL");
    const zone = String(filters.zoneId || "ALL");
    const selectedDepots = scenario.depots.filter((depot) => (role === "ALL" || depot.role === role) && (zone === "ALL" || depot.serviceZoneIds.includes(zone)));
    return {
      schemaVersion: "stct-network-baseline-explorer-v1.9-p4",
      networkInputHash: source.activeInputHash,
      baselineHash: source.baselineInputHash,
      studyHash: source.studyHash,
      filters: { role, zoneId: zone },
      depots: selectedDepots.map((depot) => ({
        depotId: depot.depotId, name: depot.name, role: depot.role, coordinate: depot.coordinate,
        coordinateSource: source.dataSource.sourceRef, capacities: clone(depot.capacity), utilization: depotUtilization.get(depot.depotId) || null,
        fixedOperatingCost: depot.fixedOperatingCost ?? null, variableHandlingCost: depot.variableHandlingCost ?? null,
        serviceZoneIds: depot.serviceZoneIds, docks: depot.dockIds.length,
        dockCapacity: scenario.docks.filter((dock) => dock.depotId === depot.depotId).reduce((sum, dock) => sum + dock.simultaneousCapacity, 0),
        vehiclesByType: scenario.vehicleTypes.map((type) => ({ vehicleTypeId: type.vehicleTypeId, count: scenario.vehicles.filter((vehicle) => vehicle.homeDepotId === depot.depotId && vehicle.vehicleTypeId === type.vehicleTypeId).length })),
        driverCount: scenario.drivers.filter((driver) => driver.homeDepotId === depot.depotId).length,
      })),
      routes: evaluation?.visual.layers.tripRoutes || [],
      capacityStress: evaluation?.visual.layers.capacityStress || [],
      zones: scenario.zones.map((zone) => ({ zoneId: zone.zoneId, mode: zone.mode, depotIds: zone.depotIds, geometrySource: zone.geometry.type })),
      docksAndWaves: { docks: scenario.docks.length, simultaneousCapacity: scenario.docks.reduce((sum, dock) => sum + dock.simultaneousCapacity, 0), waves: evaluation?.plan.waves.waves.length || 0, reservations: evaluation?.plan.dock.reservations.length || 0, congestion: evaluation?.accounting.metrics.dockCongestion || 0 },
      fleetAndDrivers: { vehicles: scenario.vehicles.length, drivers: scenario.drivers.length, vehicleTypes: scenario.vehicleTypes.length, vehicleCountsByType: scenario.vehicleTypes.map((type) => ({ vehicleTypeId: type.vehicleTypeId, count: scenario.vehicles.filter((vehicle) => vehicle.vehicleTypeId === type.vehicleTypeId).length })), driverSkills: [...new Set(scenario.drivers.flatMap((driver) => driver.skills))], dutyAssumptions: { maxDutyMinutes: [...new Set(scenario.drivers.map((driver) => driver.maxDutyMinutes))], maxDrivingMinutes: [...new Set(scenario.drivers.map((driver) => driver.maxDrivingMinutes))], breakPolicies: [...new Set(scenario.drivers.flatMap((driver) => driver.requiredBreaks.map((item) => item.locationPolicy)))] } },
      executionShape: evaluation ? { trips: evaluation.plan.trip.trips.length, waves: evaluation.plan.waves.waves.length, assigned: evaluation.accounting.metrics.assignedCount, unassigned: evaluation.plan.trip.unassigned.length, distanceKm: evaluation.plan.metrics.routeDistanceKm, routeDistanceSummaryKm: { average: routeDistances.length ? routeDistances.reduce((sum, value) => sum + value, 0) / routeDistances.length : null, p90: percentile(routeDistances, .9), maximum: routeDistances.length ? Math.max(...routeDistances) : null }, latestCompletionMinute: evaluation.accounting.metrics.latestCompletionMinute } : null,
      costComponents: evaluation?.accounting.cost.components || null,
      carbonComponents: evaluation?.accounting.carbon.components || null,
      verifier: evaluation?.verification || null,
      accountingVerifier: evaluation?.accountingVerification || null,
      assumptions: scenario.assumptions,
      missingData: ["REAL_ESTATE_COST", "LAND_AVAILABILITY", "CERTIFIED_CARBON_FACTORS"],
      roadFactBoundary: { providerId: scenario.routingContext.providerId, graphId: scenario.routingContext.graphId, matrixVersion: scenario.routingContext.matrixVersion, source: "SYNTHETIC_ROAD_FIXTURE", haversineAsRoadEconomicFact: false },
      formulaReferences: evaluation ? { costFormula: evaluation.accounting.trustLab.costFormula, allocationMethod: evaluation.accounting.cost.allocationMethod, carbonFactorSource: evaluation.accounting.carbon.factorSource } : null,
      noWebGL: evaluation ? store.context.Visualization.noWebGL(evaluation.visual) : null,
      screenReaderSummary: evaluation ? store.context.Visualization.screenReaderSummary(evaluation.visual) : "Network evaluation pending.",
      currentNetworkOptimalityClaim: false,
      currentNetworkLabel: "CURRENT_NETWORK_NOT_OPTIMALITY_CLAIM",
      sourceAuthority: "network-contract-v18 + network-accounting-v18",
    };
  }
  function toJson(store, filters = {}) { return `${JSON.stringify(project(store, filters), null, 2)}\n`; }
  function toCsv(store, filters = {}) { const rows = project(store, filters).depots; return `depot_id,name,role,zones,docks,vehicles,drivers,daily_orders,volume,weight,utilization,fixed_cost,handling_cost\n${rows.map((row) => [row.depotId, row.name, row.role, row.serviceZoneIds.join("|"), row.docks, row.vehiclesByType.reduce((sum, item) => sum + item.count, 0), row.driverCount, row.capacities.dailyOrders, row.capacities.volume, row.capacities.weight, row.utilization?.orderUtilization ?? "MISSING", row.fixedOperatingCost ?? "MISSING", row.variableHandlingCost ?? "MISSING"].map(csv).join(",")).join("\n")}\n`; }
  function toPrintableHtml(store, filters = {}) { const value = project(store, filters); return `<!doctype html><html><head><meta charset="utf-8"><title>Network Baseline</title></head><body><h1>Network Baseline</h1><p>${escapeHtml(value.currentNetworkLabel)} · ${escapeHtml(value.networkInputHash)}</p><table><thead><tr><th>Depot</th><th>Role</th><th>Capacity</th><th>Utilization</th></tr></thead><tbody>${value.depots.map((row) => `<tr><td>${escapeHtml(row.name || row.depotId)}</td><td>${escapeHtml(row.role)}</td><td>${escapeHtml(row.capacities.dailyOrders)}</td><td>${escapeHtml(row.utilization?.orderUtilization ?? "MISSING")}</td></tr>`).join("")}</tbody></table></body></html>`; }
  return Object.freeze({ project, toJson, toCsv, toPrintableHtml });
});
