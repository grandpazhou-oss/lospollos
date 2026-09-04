"use strict";

const GENERATOR_VERSION = "stct-synthetic-network-generator-v1.8.0";

function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeNetwork(options = {}) {
  const orderCount = options.orderCount || 12;
  const depotCount = options.depotCount || 2;
  const vehicleCount = options.vehicleCount || Math.max(4, depotCount * 2);
  const driverCount = options.driverCount || vehicleCount;
  const docksPerDepot = options.docksPerDepot || 2;
  const depots = Array.from({ length: depotCount }, (_, index) => {
    const number = index + 1;
    return {
      depotId: `D${number}`,
      name: `Synthetic Depot ${number}`,
      coordinate: [117.1 + index * 0.08, 39.08 + index * 0.04],
      timezone: "Asia/Shanghai",
      role: index === depotCount - 1 && options.crossDock ? "CROSS_DOCK" : index === 0 ? "CDC" : "RDC",
      capabilities: index === depotCount - 1 && options.crossDock ? ["CROSS_DOCK", "RELOAD"] : ["DELIVERY", "PICKUP", "RELOAD"],
      operatingWindows: [{ start: "06:00", end: "23:59" }],
      serviceZoneIds: [`Z${number}`],
      dockIds: Array.from({ length: docksPerDepot }, (_, dockIndex) => `DOCK-${number}-${String.fromCharCode(65 + dockIndex)}`),
      reloadSupported: true,
      transferSupported: Boolean(options.crossDock || index === 0),
      startVehicleIds: Array.from({ length: vehicleCount }, (_, vehicleIndex) => vehicleIndex).filter((vehicleIndex) => vehicleIndex % depotCount === index).map((vehicleIndex) => `V${vehicleIndex + 1}`),
      allowedVehicleTypes: ["VT-DIESEL", "VT-EV"],
      fixedOperatingCost: 300,
      variableHandlingCost: 1.5,
      carbonFactor: 0.015,
      capacity: { dailyOrders: Math.max(orderCount, 20), volume: Math.max(orderCount * 4, 80), weight: Math.max(orderCount * 20, 400), handlingMinutes: 1200, parkingSlots: vehicleCount },
    };
  });
  const docks = depots.flatMap((depot) => depot.dockIds.map((dockId, dockIndex) => ({
    dockId,
    depotId: depot.depotId,
    type: dockIndex ? "MIXED" : "LOAD",
    compatibleVehicleTypes: ["VT-DIESEL", "VT-EV"],
    operatingWindows: [{ start: "06:00", end: "23:59" }],
    simultaneousCapacity: 1,
    loadRate: 3,
    unloadRate: 4,
    fixedSetupMinutes: 8,
    queuePolicy: dockIndex ? "PRIORITY" : "FCFS",
  })));
  const zones = depots.map((depot, index) => ({ zoneId: `Z${index + 1}`, mode: index % 2 ? "PREFERRED" : "HARD", depotIds: [depot.depotId], geometry: { type: "FixtureCircle", center: depot.coordinate, radiusKm: 35 } }));
  const vehicleTypes = [
    { vehicleTypeId: "VT-DIESEL", capacity: { volume: 20, weight: 1000 }, cost: { fixed: 120, trip: 20, perKm: 1.1, perMinute: 0.2 }, emission: { loadedKgPerKm: 0.7, emptyKgPerKm: 0.55 }, energy: {} },
    { vehicleTypeId: "VT-EV", capacity: { volume: 16, weight: 800 }, cost: { fixed: 145, trip: 18, perKm: 0.72, perMinute: 0.18 }, emission: { loadedKgPerKm: 0.08, emptyKgPerKm: 0.06 }, energy: { batteryKwh: 120, initialSoc: 0.9, reserveSoc: 0.2, kwhPerKmLoaded: 0.6, kwhPerKmEmpty: 0.45 } },
  ];
  const vehicles = Array.from({ length: vehicleCount }, (_, index) => {
    const home = depots[index % depotCount].depotId;
    const type = index % 3 === 0 ? "VT-EV" : "VT-DIESEL";
    return {
      vehicleId: `V${index + 1}`,
      vehicleTypeId: type,
      homeDepotId: home,
      allowedStartDepotIds: [home],
      allowedEndDepotIds: depots.map((depot) => depot.depotId),
      capacity: type === "VT-EV" ? { volume: 16, weight: 800 } : { volume: 20, weight: 1000 },
      cost: {}, emission: {}, energy: {}, routingProfile: "CAR", maxTrips: 3,
      availabilityWindows: [{ start: "06:00", end: "23:59" }], reloadCompatibility: depots.map((depot) => depot.depotId),
    };
  });
  const drivers = Array.from({ length: driverCount }, (_, index) => ({
    driverId: `DR${index + 1}`,
    homeDepotId: depots[index % depotCount].depotId,
    skills: ["DELIVERY", "PICKUP"],
    shiftWindows: [{ start: "06:00", end: "23:59" }],
    maxDrivingMinutes: 540,
    maxDutyMinutes: 720,
    requiredBreaks: [{ breakId: `BR${index + 1}`, earliestStart: "11:00", latestStart: "15:00", duration: 30, triggerDrivingMinutes: 240, locationPolicy: "ANY_STOP" }],
    compatibleVehicleTypes: ["VT-DIESEL", "VT-EV"],
  }));
  const orders = Array.from({ length: orderCount }, (_, index) => {
    const depot = depots[index % depotCount];
    const paired = options.pickupDelivery && index < Math.floor(orderCount / 2) * 2;
    return {
      orderId: `O${String(index + 1).padStart(4, "0")}`,
      taskType: paired && index % 2 === 0 ? "PICKUP" : "DELIVERY",
      coordinate: [depot.coordinate[0] + 0.01 + (index % 7) * 0.004, depot.coordinate[1] + 0.008 + (index % 5) * 0.003],
      demand: { volume: 1 + index % 4, weight: 10 + index % 6 * 5 },
      serviceDuration: 8 + index % 4,
      timeWindows: [{ start: "08:00", end: "20:00" }],
      priorityWeight: index % 9 === 0 ? 10 : 1,
      allowedDepotIds: [depot.depotId], preferredDepotId: depot.depotId, forbiddenDepotIds: [],
      requiredSkills: [paired && index % 2 === 0 ? "PICKUP" : "DELIVERY"], requiredVehicleTypes: [], zoneId: `Z${index % depotCount + 1}`,
      shipmentPairId: paired ? `PAIR-${Math.floor(index / 2) + 1}` : "", transferPolicy: options.crossDock ? "ALLOW_CROSS_DOCK" : "DIRECT",
      releaseTime: "07:00", dueTime: "20:00",
    };
  });
  const pickupDeliveryPairs = options.pickupDelivery ? Array.from({ length: Math.floor(orderCount / 2) }, (_, index) => ({
    pairId: `PAIR-${index + 1}`, pickupOrderId: orders[index * 2].orderId, deliveryOrderId: orders[index * 2 + 1].orderId,
    precedence: "PICKUP_BEFORE_DELIVERY", sameVehicleRequired: true, sameTripRequired: false, transferAllowed: Boolean(options.crossDock), maxRideTime: 360, loadTransformation: { volumeMultiplier: 1 },
  })) : [];
  const network = {
    schemaVersion: "stct-network-scenario-v1.8", networkId: options.networkId || "SYNTHETIC-NETWORK-001", dataClassification: "SYNTHETIC",
    planningHorizon: { mode: options.horizonMode || "MULTI_SHIFT", timezone: "Asia/Shanghai", businessDayStart: "06:00", businessDayEnd: "23:59", crossMidnightPolicy: options.crossMidnightPolicy || "ALLOW" },
    depots, docks, zones, orders, pickupDeliveryPairs, transfers: [], vehicles, drivers, vehicleTypes, waves: [], trips: [], routes: [], dockReservations: [],
    policies: { serviceFirst: true, hardZones: true, openRoutes: true, breakPolicy: "REQUIRED" },
    constraints: { maxTripsPerVehicle: 3, hardDepotCapacity: true, hardDockCapacity: true },
    assumptions: { syntheticRoadFactor: 1.28, averageSpeedKph: 32, synthetic: true },
    routingContext: { providerId: "SYNTHETIC_ROAD_FIXTURE", providerVersion: "v1.8", graphId: "TIANJIN-ANON-001", matrixVersion: "v1", closures: [] },
    displayLabel: options.displayLabel || "Synthetic network", uiState: options.uiState || { selectedDepotId: "D1" }, recordedAt: options.recordedAt || "2026-09-04T00:00:00Z",
  };
  if (options.seed !== undefined) {
    const random = seededRandom(options.seed);
    network.orders.forEach((order) => {
      order.coordinate = [
        Number((order.coordinate[0] + (random() - 0.5) * 0.002).toFixed(6)),
        Number((order.coordinate[1] + (random() - 0.5) * 0.002).toFixed(6)),
      ];
      order.priorityWeight = 1 + Math.floor(random() * 10);
    });
    network.assumptions.generatorVersion = GENERATOR_VERSION;
    network.assumptions.generatorSeed = Number(options.seed);
  }
  return network;
}

function parseCorpusName(name) {
  const match = String(name).match(/^(.+)-D(\d+)-V(\d+)-O(\d+)-S(\d+)$/);
  if (!match) throw new Error(`Invalid corpus case name: ${name}`);
  return { family: match[1], depotCount: Number(match[2]), vehicleCount: Number(match[3]), orderCount: Number(match[4]), seed: Number(match[5]) };
}

function makeCorpusCase(name) {
  const spec = parseCorpusName(name);
  const pickupDelivery = ["pickup-delivery", "cross-dock", "mixed-risk"].includes(spec.family);
  const crossDock = ["cross-dock", "mixed-risk"].includes(spec.family);
  const scenario = makeNetwork({ ...spec, networkId: `SYNTHETIC-${name}`, pickupDelivery, crossDock, docksPerDepot: spec.family === "dock-congestion" ? 1 : 2 });
  scenario.displayLabel = `Synthetic ${spec.family}`;
  if (crossDock) scenario.pickupDeliveryPairs.forEach((pair) => { pair.sameVehicleRequired = false; pair.sameTripRequired = false; pair.transferAllowed = true; });
  if (spec.family === "returns-backhaul") {
    scenario.orders.filter((_, index) => index % 5 === 0).forEach((order) => { order.taskType = "RETURN"; });
  }
  if (["demand-shock", "mixed-risk"].includes(spec.family)) {
    scenario.orders.forEach((order) => { order.demand.volume = Number((order.demand.volume * 1.25).toFixed(3)); });
  }
  if (["depot-outage", "mixed-risk"].includes(spec.family)) {
    scenario.depots[0].capacity.dailyOrders = 0;
    scenario.assumptions.depotOutage = scenario.depots[0].depotId;
  }
  if (["road-closure", "mixed-risk"].includes(spec.family)) {
    scenario.routingContext.closures.push({ closureId: `CLOSE-${spec.seed}`, fromCoordinate: scenario.depots[0].coordinate, toCoordinate: scenario.orders[0].coordinate, status: "CLOSED" });
  }
  if (spec.family === "multi-shift") {
    scenario.planningHorizon.mode = "MULTI_SHIFT";
    scenario.drivers.forEach((driver) => { driver.shiftWindows = [{ start: "06:00", end: "14:00" }, { start: "15:00", end: "23:00" }]; });
  }
  if (spec.family === "open-route") scenario.policies.openRoutes = true;
  if (spec.family === "ev-fleet") scenario.assumptions.energyModel = "SYNTHETIC_SCENARIO";
  if (spec.family === "dock-congestion") scenario.assumptions.dockPressure = "INTENTIONAL";
  if (spec.family === "mixed-risk") {
    scenario.assumptions.combinedRisk = ["CAPACITY", "CUSTODY", "ROAD_CLOSURE"];
  }
  return { name, spec, expectedClass: spec.orderCount > 500 ? "PROTECTED_SCALE" : "VALID_OR_EXPLICIT_UNASSIGNED", scenario, provenance: { generatorVersion: GENERATOR_VERSION, seed: spec.seed, dataClassification: "SYNTHETIC" } };
}

function clone(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function transformScenario(source, transform) {
  const scenario = clone(source);
  const firstOrder = scenario.orders[0];
  const firstDepot = scenario.depots[0];
  const firstDock = scenario.docks[0];
  const firstDriver = scenario.drivers[0];
  const firstType = scenario.vehicleTypes[0];
  const actions = {
    "input-reorder": () => ["depots", "docks", "zones", "orders", "pickupDeliveryPairs", "vehicles", "drivers", "vehicleTypes"].forEach((key) => scenario[key].reverse()),
    "label-only-change": () => { scenario.displayLabel = `${scenario.displayLabel} revised`; scenario.uiState = { selectedDepotId: scenario.depots.at(-1).depotId }; },
    "capacity-increase": () => { firstDepot.capacity.volume += 1000; scenario.vehicles[0].capacity.volume += 100; },
    "window-relax": () => { firstOrder.timeWindows = [{ start: "06:00", end: "23:00" }]; },
    "window-tighten": () => { firstOrder.timeWindows = [{ start: "10:00", end: "10:30" }]; },
    "add-ineligible-depot": () => scenario.depots.push({ ...clone(firstDepot), depotId: "D-INELIGIBLE", name: "Synthetic Ineligible Depot", dockIds: [], serviceZoneIds: [], startVehicleIds: [], capacity: { ...firstDepot.capacity, dailyOrders: 0 } }),
    "remove-unused-depot": () => { scenario.depots = scenario.depots.filter((depot) => depot.depotId !== "D-UNUSED"); },
    "add-unused-dock": () => { const dockId = "DOCK-UNUSED"; scenario.docks.push({ ...clone(firstDock), dockId }); firstDepot.dockIds.push(dockId); },
    "matrix-scale": () => { scenario.routingContext.syntheticMatrixScale = 1.1; },
    "closure-add": () => scenario.routingContext.closures.push({ closureId: "CLOSE-META", fromCoordinate: firstDepot.coordinate, toCoordinate: firstOrder.coordinate, status: "CLOSED" }),
    "closure-remove": () => { scenario.routingContext.closures = []; },
    "priority-increase": () => { firstOrder.priorityWeight += 10; },
    "vehicle-cost-increase": () => { firstType.cost.perKm += 0.5; },
    "emission-increase": () => { firstType.emission.loadedKgPerKm += 0.2; },
    "dock-capacity-increase": () => { firstDock.simultaneousCapacity += 1; },
    "dock-capacity-decrease": () => { firstDock.simultaneousCapacity = 1; },
    "break-relax": () => { firstDriver.requiredBreaks[0].earliestStart = "10:00"; firstDriver.requiredBreaks[0].latestStart = "16:00"; },
    "break-tighten": () => { firstDriver.requiredBreaks[0].earliestStart = "12:00"; firstDriver.requiredBreaks[0].latestStart = "12:15"; },
    "transfer-enable": () => { scenario.pickupDeliveryPairs.forEach((pair) => { pair.transferAllowed = true; }); scenario.orders.forEach((order) => { order.transferPolicy = "ALLOW_CROSS_DOCK"; }); },
    "transfer-disable": () => { scenario.pickupDeliveryPairs.forEach((pair) => { pair.transferAllowed = false; }); scenario.orders.forEach((order) => { order.transferPolicy = "DIRECT"; }); },
  };
  if (!actions[transform]) throw new Error(`Unsupported transform: ${transform}`);
  actions[transform]();
  return scenario;
}

module.exports = { GENERATOR_VERSION, seededRandom, makeNetwork, parseCorpusName, makeCorpusCase, transformScenario, clone };
