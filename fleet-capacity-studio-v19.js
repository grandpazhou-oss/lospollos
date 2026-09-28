(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) { root.STCTPlatformV19 = root.STCTPlatformV19 || {}; root.STCTPlatformV19.fleetCapacityStudio = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const csv = (value) => { const source = String(value ?? ""); const safe = /^[\t\r\n ]*[=+\-@]/.test(source) ? `'${source}` : source; return `"${safe.replaceAll('"', '""')}"`; };
  function project(store, filters = {}) {
    const source = store.snapshot();
    const scenario = source.activeRecord.scenario;
    const ledger = source.evaluation?.accounting;
    const depotId = String(filters.depotId || "ALL");
    const vehicleTypeId = String(filters.vehicleTypeId || "ALL");
    const period = String(filters.period || source.demandPeriod);
    const vehicles = scenario.vehicles.filter((vehicle) => (depotId === "ALL" || vehicle.homeDepotId === depotId) && (vehicleTypeId === "ALL" || vehicle.vehicleTypeId === vehicleTypeId));
    const byType = scenario.vehicleTypes.filter((type) => vehicleTypeId === "ALL" || type.vehicleTypeId === vehicleTypeId).map((type) => ({ vehicleTypeId: type.vehicleTypeId, count: vehicles.filter((vehicle) => vehicle.vehicleTypeId === type.vehicleTypeId).length, capacityVolume: type.capacity.volume, capacityWeight: type.capacity.weight, fixedCost: type.cost.fixed, loadedKgPerKm: type.emission.loadedKgPerKm, physicalVehicles: true, virtualTripSlots: vehicles.filter((vehicle) => vehicle.vehicleTypeId === type.vehicleTypeId).reduce((sum, vehicle) => sum + vehicle.maxTrips, 0) }));
    const byDepot = scenario.depots.filter((depot) => depotId === "ALL" || depot.depotId === depotId).map((depot) => {
      const depotVehicles = vehicles.filter((vehicle) => vehicle.homeDepotId === depot.depotId);
      const depotDrivers = scenario.drivers.filter((driver) => driver.homeDepotId === depot.depotId);
      const orders = scenario.orders.filter((order) => order.allowedDepotIds.includes(depot.depotId));
      const orderVolume = orders.reduce((sum, order) => sum + Number(order.demand.volume || 0), 0);
      const orderWeight = orders.reduce((sum, order) => sum + Number(order.demand.weight || 0), 0);
      const docks = scenario.docks.filter((dock) => dock.depotId === depot.depotId);
      const waves = source.evaluation?.plan.waves.waves.filter((wave) => wave.depotId === depot.depotId) || [];
      return { depotId: depot.depotId, vehicles: depotVehicles.length, physicalVehicles: depotVehicles.length, virtualTripSlots: depotVehicles.reduce((sum, vehicle) => sum + vehicle.maxTrips, 0), parkingSlots: depot.capacity.parkingSlots, drivers: depotDrivers.length, driverSkills: [...new Set(depotDrivers.flatMap((driver) => driver.skills))], dutyMinutes: [...new Set(depotDrivers.map((driver) => driver.maxDutyMinutes))], breakAssumptions: [...new Set(depotDrivers.flatMap((driver) => driver.requiredBreaks.map((item) => `${item.duration}:${item.locationPolicy}`)))], docks: docks.length, simultaneousDockCapacity: docks.reduce((sum, dock) => sum + dock.simultaneousCapacity, 0), orders: orders.length, orderVolume, orderWeight, handlingCapacity: { dailyOrders: depot.capacity.dailyOrders, volume: depot.capacity.volume, weight: depot.capacity.weight }, orderHeadroom: depot.capacity.dailyOrders - orders.length, volumeHeadroom: depot.capacity.volume - orderVolume, weightHeadroom: depot.capacity.weight - orderWeight, waves: waves.length, cutoffRisks: waves.reduce((sum, wave) => sum + (wave.risks || []).length, 0) };
    });
    const tripCount = source.evaluation?.plan.trip.trips.length || 0;
    const tripChains = source.evaluation?.plan.trip.tripChains || [];
    const reasonCodes = [];
    if (byDepot.some((row) => row.orderHeadroom < 0 || row.volumeHeadroom < 0 || row.weightHeadroom < 0)) reasonCodes.push("DEPOT_CAPACITY_EXCEEDED");
    if (Number(ledger?.metrics.dockCongestion || 0) > 0) reasonCodes.push("DOCK_QUEUE_PRESSURE");
    if ((source.evaluation?.plan.trip.unassigned || []).length) reasonCodes.push("UNASSIGNED_ORDERS");
    return {
      schemaVersion: "stct-fleet-capacity-studio-v1.9-p4", inputHash: source.activeInputHash, studyHash: source.studyHash,
      filters: { depotId, vehicleTypeId, period }, verified: source.evaluation?.verification.status === "PASS", accountingVerified: source.evaluation?.accountingVerification.status === "PASS",
      byType, byDepot, utilization: ledger?.metrics.vehicleUtilization || [], driverUtilization: ledger?.metrics.driverUtilization || [], tripUtilization: ledger?.metrics.tripUtilization || [],
      operations: { tripCount, multiTripChains: tripChains.filter((row) => row.tripIds.length > 1).length, waves: source.evaluation?.plan.waves.waves.length || 0, emptyRepositionDistanceKm: ledger?.metrics.emptyDistanceKm ?? null, dockQueueMetric: ledger?.metrics.dockCongestion ?? null, unassigned: source.evaluation?.plan.trip.unassigned || [], unassignedReasons: ledger?.metrics.unassignedReasons || {} },
      bottlenecks: { status: reasonCodes.length ? "ATTENTION" : "HEADROOM", reasonCodes },
      scenarioTemplates: [
        { id: "ADD_VEHICLE_1", type: "FLEET_MIX_CHANGE", payload: { count: 1 } }, { id: "ADD_VEHICLE_2", type: "FLEET_MIX_CHANGE", payload: { count: 2 } },
        { id: "VEHICLE_TYPE_SUBSTITUTION", type: "FLEET_MIX_CHANGE", payload: { count: 1, vehicleTypeId: scenario.vehicleTypes.at(-1)?.vehicleTypeId } },
        { id: "DEPOT_CAPACITY_EXPANSION", type: "DEPOT_CAPACITY_CHANGE", payload: { depotId: scenario.depots[0]?.depotId, field: "dailyOrders", value: Number(scenario.depots[0]?.capacity.dailyOrders || 0) + 100 } },
        { id: "DOCK_CAPACITY_EXPANSION", type: "DOCK_CAPACITY_CHANGE", payload: { dockId: scenario.docks[0]?.dockId, value: Number(scenario.docks[0]?.simultaneousCapacity || 1) + 1 } },
        { id: "SHIFT_EXTENSION", type: "SHIFT_EXTENSION", payload: { depotId: scenario.depots[0]?.depotId, minutes: 120 } },
        { id: "FLEET_MIX_CHANGE", type: "FLEET_MIX_CHANGE", payload: { count: 2 } },
      ],
      physicalVsVirtualBoundary: "PHYSICAL_VEHICLES_ARE_ASSETS; VIRTUAL_TRIP_SLOTS_ARE_MAX_TRIPS_CAPACITY",
      productionCertificationClaim: false,
      sourceAuthorities: ["network-solver-v18", "network-accounting-v18"],
    };
  }
  function createScenario(store, templateId) { const template = project(store).scenarioTemplates.find((row) => row.id === templateId); if (!template || template.supported === false) throw Object.assign(new Error(template?.reason || "Unknown capacity scenario"), { code: "DESIGN_CAPACITY_SCENARIO_UNAVAILABLE" }); return store.createScenario(template.type, template.payload); }
  function toJson(store, filters = {}) { return `${JSON.stringify(project(store, filters), null, 2)}\n`; }
  function toCsv(store, filters = {}) { return `depot_id,physical_vehicles,virtual_trip_slots,drivers,docks,orders,order_headroom,volume_headroom,weight_headroom,waves,cutoff_risks\n${project(store, filters).byDepot.map((row) => [row.depotId, row.physicalVehicles, row.virtualTripSlots, row.drivers, row.docks, row.orders, row.orderHeadroom, row.volumeHeadroom, row.weightHeadroom, row.waves, row.cutoffRisks].map(csv).join(",")).join("\n")}\n`; }
  return Object.freeze({ project, createScenario, toJson, toCsv });
});
