(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) { root.STCTPlatformV19 = root.STCTPlatformV19 || {}; root.STCTPlatformV19.resilienceStudio = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const csv = (value) => { const source = String(value ?? ""); const safe = /^[\t\r\n ]*[=+\-@]/.test(source) ? `'${source}` : source; return `"${safe.replaceAll('"', '""')}"`; };
  function project(store) {
    const source = store.snapshot();
    const scenario = source.activeRecord.scenario;
    const evaluation = source.evaluation;
    const lastAudit = source.activeRecord.audit.at(-1) || {};
    const affectedDepotId = lastAudit.payload?.depotId || "";
    const before = source.activeRecord.impactBaseline;
    const affectedIds = new Set((before?.assignments || []).filter(row => row.assignedDepotId === affectedDepotId && before.servedOrderIds.includes(row.orderId)).map(row => row.orderId));
    const affectedOrders = affectedIds.size;
    const remainingCapacity = scenario.depots.filter((depot) => depot.depotId !== affectedDepotId).reduce((sum, depot) => sum + Number(depot.capacity.dailyOrders || 0), 0);
    const verified = Boolean(before && evaluation?.verification.status === "PASS" && evaluation?.accountingVerification.status === "PASS");
    const served = new Set(evaluation?.plan.trip.trips.flatMap(trip => trip.orderIds) || []);
    const coveredIds = verified ? [...new Set(evaluation.plan.assignment.assignments.filter(row => affectedIds.has(row.orderId) && row.assignedDepotId !== affectedDepotId && served.has(row.orderId)).map(row => row.orderId))] : [];
    const impact = {
      affectedDemand: before ? affectedOrders : null,
      theoreticalCapacityUpperBound: Math.min(affectedOrders, remainingCapacity),
      verifiedBackupCoverage: verified ? coveredIds.length : null,
      uncoveredAffectedDemand: verified ? affectedOrders - coveredIds.length : null,
      assessmentStatus: verified ? "VERIFIED" : before && evaluation ? "FAILED" : "NOT_EVALUATED",
      coverageUnit: "ORDERS", affectedOrderIds: [...affectedIds], verifiedCoveredOrderIds: coveredIds,
      backupCoverage: verified ? coveredIds.length : null, uncoveredDemand: verified ? affectedOrders - coveredIds.length : null,
      ...(evaluation ? {
      spareCapacity: remainingCapacity - affectedOrders, service: evaluation.accounting.metrics.serviceLevel, cost: evaluation.accounting.cost.total,
      carbonKg: evaluation.accounting.carbon.totalKg, vehicles: evaluation.plan.trip.tripChains.length, trips: evaluation.plan.trip.trips.length,
      dockCongestion: evaluation.accounting.metrics.dockCongestion, waves: evaluation.plan.waves.waves.length, verification: evaluation.verification.status,
      } : {}),
    };
    return {
      schemaVersion: "stct-resilience-studio-v1.9-p4", inputHash: source.activeInputHash, baselineInputHash: source.baselineInputHash, studyHash: source.studyHash,
      facilities: scenario.depots.map((depot) => ({ depotId: depot.depotId, role: depot.role, transferSupported: depot.transferSupported, vehicleCount: scenario.vehicles.filter((vehicle) => vehicle.homeDepotId === depot.depotId).length, dockCount: depot.dockIds.length, dailyOrderCapacity: depot.capacity.dailyOrders })),
      actions: [
        { id: "DEPOT_OUTAGE", supported: true, type: "DEPOT_OUTAGE" }, { id: "DOCK_FAILURE", supported: true, type: "DOCK_FAILURE" }, { id: "ROAD_CLOSURE", supported: true, type: "ROAD_CLOSURE" },
        { id: "VEHICLE_TYPE_SHORTAGE", supported: true, type: "VEHICLE_TYPE_SHORTAGE" },
        { id: "DRIVER_UNAVAILABLE", supported: true, type: "DRIVER_UNAVAILABLE" },
        { id: "CROSS_DOCK_INTERRUPTION", supported: true, type: "CROSS_DOCK_INTERRUPTION" },
      ],
      activeShock: { type: source.activeRecord.type, source: lastAudit.action || "BASELINE", assumptions: lastAudit.payload || {} },
      impact, suggestions: impact && impact.uncoveredDemand > 0 ? [{ action: "OPEN_FLEET_CAPACITY", target: "/design/fleet-capacity", reason: "UNASSIGNED_DEMAND" }] : [{ action: "REVIEW_BACKUP_COVERAGE", target: "/design/network-scenarios", reason: "SCENARIO_REVIEW" }],
      changedInputOnly: true, autoApply: false, probabilityClaim: false, completeSupplyChainResilienceClaim: false, facilityLocationRecommendation: false,
      comparisonSemantics: source.activeInputHash === source.baselineInputHash ? "SAME_INPUT" : "SCENARIO_CHANGED",
      map: evaluation?.visual || null, tableEquivalent: impact ? [impact] : [],
      provenance: scenario.routingContext, sourceAuthority: "scenario-lab-v18",
    };
  }
  function create(store, action, depotId) {
    if (["DEPOT_OUTAGE", "DOCK_FAILURE"].includes(action)) return store.createShock(action, { depotId });
    if (action === "ROAD_CLOSURE") return store.createScenario("ROAD_CLOSURE", { closureId: `DESIGN-CLOSURE-${store.snapshot().revision + 1}`, from: "FIXTURE-A", to: "FIXTURE-B" });
    if (action === "VEHICLE_TYPE_SHORTAGE") return store.createScenario(action, { vehicleTypeId: store.snapshot().activeRecord.scenario.vehicleTypes[0]?.vehicleTypeId, count: 1 });
    if (action === "DRIVER_UNAVAILABLE") return store.createScenario(action, { driverId: store.snapshot().activeRecord.scenario.drivers[0]?.driverId });
    if (action === "CROSS_DOCK_INTERRUPTION") return store.createScenario(action, { depotId: depotId || store.snapshot().activeRecord.scenario.depots.find((depot) => depot.transferSupported)?.depotId });
    throw Object.assign(new Error("Unsupported resilience action"), { code: "DESIGN_RESILIENCE_ACTION_UNSUPPORTED" });
  }
  function toJson(store) { return `${JSON.stringify(project(store), null, 2)}\n`; }
  function toCsv(store) { const value = project(store); const impact = value.impact || {}; return `scenario,input_hash,verification,affected_demand,backup_coverage,uncovered_demand,spare_capacity,service,cost,carbon_kg,trips,waves\n${[value.activeShock.type, value.inputHash, impact.verification || "NOT_RUN", impact.affectedDemand ?? "", impact.backupCoverage ?? "", impact.uncoveredDemand ?? "", impact.spareCapacity ?? "", impact.service ?? "", impact.cost ?? "", impact.carbonKg ?? "", impact.trips ?? "", impact.waves ?? ""].map(csv).join(",")}\n`; }
  return Object.freeze({ project, create, toJson, toCsv });
});
