(function (root, factory) {
  "use strict";
  const contract = typeof module === "object" && module.exports ? require("./network-contract-v18.js") : root.STCTV18?.networkContract;
  const api = factory(contract);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.designDataAdapter = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Contract) {
  "use strict";

  if (!Contract?.normalizeScenario || !Contract?.identityBundle) throw new Error("STCT v1.8 network contract is required.");
  const SCHEMA_VERSION = "stct-design-data-adapter-v1.9-p4";
  const GENERATOR_VERSION = "stct-design-synthetic-study-v1.9-p4";
  const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));

  function seededRandom(seed) {
    let state = Number(seed) >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  function createSyntheticStudy(options = {}) {
    const orderCount = Number(options.orderCount || 500);
    const depotCount = Number(options.depotCount || 5);
    const vehicleCount = Number(options.vehicleCount || 50);
    const docksPerDepot = Number(options.docksPerDepot || 4);
    const random = seededRandom(options.seed ?? 1904);
    const vehicleTypes = [
      { vehicleTypeId: "VT-DIESEL", capacity: { volume: 20, weight: 1000 }, cost: { fixed: 120, trip: 20, perKm: 1.1, perMinute: 0.2 }, emission: { loadedKgPerKm: 0.7, emptyKgPerKm: 0.55 }, energy: {} },
      { vehicleTypeId: "VT-EV", capacity: { volume: 16, weight: 800 }, cost: { fixed: 145, trip: 18, perKm: 0.72, perMinute: 0.18 }, emission: { loadedKgPerKm: 0.08, emptyKgPerKm: 0.06 }, energy: { batteryKwh: 120, initialSoc: 0.9, reserveSoc: 0.2, kwhPerKmLoaded: 0.6, kwhPerKmEmpty: 0.45 } },
    ];
    const depots = Array.from({ length: depotCount }, (_, index) => {
      const number = index + 1;
      return {
        depotId: `D${number}`,
        name: `Synthetic Depot ${number}`,
        coordinate: [117.1 + index * 0.08, 39.08 + index * 0.04],
        timezone: "Asia/Shanghai",
        role: index === 0 ? "CDC" : "RDC",
        capabilities: ["DELIVERY", "PICKUP", "RELOAD"],
        operatingWindows: [{ start: "06:00", end: "23:59" }],
        serviceZoneIds: [`Z${number}`],
        dockIds: Array.from({ length: docksPerDepot }, (_, dockIndex) => `DOCK-${number}-${String.fromCharCode(65 + dockIndex)}`),
        reloadSupported: true,
        transferSupported: index === 0,
        startVehicleIds: Array.from({ length: vehicleCount }, (_, vehicleIndex) => vehicleIndex).filter((vehicleIndex) => vehicleIndex % depotCount === index).map((vehicleIndex) => `V${vehicleIndex + 1}`),
        allowedVehicleTypes: vehicleTypes.map((row) => row.vehicleTypeId),
        fixedOperatingCost: 300,
        variableHandlingCost: 1.5,
        carbonFactor: 0.015,
        capacity: { dailyOrders: Math.max(orderCount, 100), volume: Math.max(orderCount * 4, 400), weight: Math.max(orderCount * 20, 2000), handlingMinutes: 1200, parkingSlots: vehicleCount },
      };
    });
    const docks = depots.flatMap((depot) => depot.dockIds.map((dockId, dockIndex) => ({
      dockId,
      depotId: depot.depotId,
      type: dockIndex ? "MIXED" : "LOAD",
      compatibleVehicleTypes: vehicleTypes.map((row) => row.vehicleTypeId),
      operatingWindows: [{ start: "06:00", end: "23:59" }],
      simultaneousCapacity: 1,
      loadRate: 3,
      unloadRate: 4,
      fixedSetupMinutes: 8,
      queuePolicy: dockIndex ? "PRIORITY" : "FCFS",
    })));
    const zones = depots.map((depot, index) => ({ zoneId: `Z${index + 1}`, mode: index % 2 ? "PREFERRED" : "HARD", depotIds: [depot.depotId], geometry: { type: "FixtureCircle", center: depot.coordinate, radiusKm: 35 } }));
    const vehicles = Array.from({ length: vehicleCount }, (_, index) => {
      const home = depots[index % depotCount].depotId;
      const type = index % 3 === 0 ? vehicleTypes[1] : vehicleTypes[0];
      return { vehicleId: `V${index + 1}`, vehicleTypeId: type.vehicleTypeId, homeDepotId: home, allowedStartDepotIds: [home], allowedEndDepotIds: depots.map((depot) => depot.depotId), capacity: clone(type.capacity), cost: {}, emission: {}, energy: {}, routingProfile: "CAR", maxTrips: 3, availabilityWindows: [{ start: "06:00", end: "23:59" }], reloadCompatibility: depots.map((depot) => depot.depotId) };
    });
    const drivers = Array.from({ length: vehicleCount }, (_, index) => ({
      driverId: `DR${index + 1}`,
      homeDepotId: depots[index % depotCount].depotId,
      skills: ["DELIVERY", "PICKUP"],
      shiftWindows: [{ start: "06:00", end: "23:59" }],
      maxDrivingMinutes: 540,
      maxDutyMinutes: 720,
      requiredBreaks: [{ breakId: `BR${index + 1}`, earliestStart: "11:00", latestStart: "15:00", duration: 30, triggerDrivingMinutes: 240, locationPolicy: "ANY_STOP" }],
      compatibleVehicleTypes: vehicleTypes.map((row) => row.vehicleTypeId),
    }));
    const orders = Array.from({ length: orderCount }, (_, index) => {
      const depot = depots[index % depotCount];
      return {
        orderId: `O${String(index + 1).padStart(4, "0")}`,
        taskType: "DELIVERY",
        coordinate: [Number((depot.coordinate[0] + 0.01 + (index % 11) * 0.003 + (random() - 0.5) * 0.002).toFixed(6)), Number((depot.coordinate[1] + 0.008 + (index % 7) * 0.003 + (random() - 0.5) * 0.002).toFixed(6))],
        demand: { volume: 1 + index % 4, weight: 10 + index % 6 * 5 },
        serviceDuration: 8 + index % 4,
        timeWindows: [{ start: "08:00", end: "20:00" }],
        priorityWeight: 1 + Math.floor(random() * 10),
        allowedDepotIds: [depot.depotId],
        preferredDepotId: depot.depotId,
        forbiddenDepotIds: [],
        requiredSkills: ["DELIVERY"],
        requiredVehicleTypes: [],
        zoneId: `Z${index % depotCount + 1}`,
        shipmentPairId: "",
        transferPolicy: "DIRECT",
        releaseTime: "07:00",
        dueTime: "20:00",
      };
    });
    const raw = {
      schemaVersion: "stct-network-scenario-v1.8",
      networkId: options.networkId || "DESIGN-SYNTHETIC-NETWORK-001",
      dataClassification: "SYNTHETIC",
      planningHorizon: { mode: "MULTI_SHIFT", timezone: "Asia/Shanghai", businessDayStart: "06:00", businessDayEnd: "23:59", crossMidnightPolicy: "ALLOW" },
      depots, docks, zones, orders, pickupDeliveryPairs: [], transfers: [], vehicles, drivers, vehicleTypes, waves: [], trips: [], routes: [], dockReservations: [],
      policies: { serviceFirst: true, hardZones: true, openRoutes: true, breakPolicy: "REQUIRED" },
      constraints: { maxTripsPerVehicle: 3, hardDepotCapacity: true, hardDockCapacity: true },
      assumptions: { syntheticRoadFactor: 1.28, averageSpeedKph: 32, synthetic: true, generatorVersion: GENERATOR_VERSION, generatorSeed: Number(options.seed ?? 1904) },
      routingContext: { providerId: "SYNTHETIC_ROAD_FIXTURE", providerVersion: "v1.8", graphId: "TIANJIN-ANON-001", matrixVersion: "v1", closures: [] },
      displayLabel: options.displayLabel || "Strategic Network FY2027",
      uiState: { selectedDepotId: "D1" },
      recordedAt: "2026-09-05T00:00:00Z",
    };
    return adoptNetworkScenario(raw, { sourceType: "LOCAL_SYNTHETIC_FIXTURE", sourceRef: GENERATOR_VERSION });
  }

  function adoptNetworkScenario(source, metadata = {}) {
    const scenario = Contract.normalizeScenario(source);
    const identity = Contract.identityBundle(scenario);
    const value = {
      schemaVersion: SCHEMA_VERSION,
      sourceType: metadata.sourceType || "DATA_HUB_ADAPTER",
      sourceRef: metadata.sourceRef || "UNSPECIFIED_SOURCE",
      dataClassification: scenario.dataClassification,
      scenario,
      identity,
      shape: Object.freeze({ depots: scenario.depots.length, docks: scenario.docks.length, vehicles: scenario.vehicles.length, orders: scenario.orders.length }),
      authority: "STCT_V18_NETWORK_CONTRACT",
      externalRequests: 0,
    };
    if (metadata.facilityData) value.facilityData = clone(metadata.facilityData);
    return Object.freeze(value);
  }

  return Object.freeze({ SCHEMA_VERSION, GENERATOR_VERSION, createSyntheticStudy, adoptNetworkScenario });
});
