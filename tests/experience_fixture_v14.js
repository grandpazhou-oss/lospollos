"use strict";

function minutes(text) {
  const [hour, minute] = String(text).split(":").map(Number);
  return hour * 60 + minute;
}

function stop(routeId, vehicleId, order, seq, rawArrival, serviceStart, departure, travelMin) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [order.lon, order.lat] },
    properties: {
      routeId,
      vehicleId,
      orderId: order.id,
      code: order.code,
      name: order.name,
      addr: order.address,
      seq,
      count: order.count,
      volume: order.volume,
      weight: order.weight,
      priority: order.priority,
      priorityWeight: order.priorityWeight,
      serviceMin: order.serviceMin,
      travelMin,
      rawArrivalMinutes: rawArrival,
      waitingMinutes: serviceStart - rawArrival,
      serviceStartMinutes: serviceStart,
      departureMinutes: departure,
      arrive: `${String(Math.floor(serviceStart / 60)).padStart(2, "0")}:${String(serviceStart % 60).padStart(2, "0")}`,
      depart: `${String(Math.floor(departure / 60)).padStart(2, "0")}:${String(departure % 60).padStart(2, "0")}`,
    },
  };
}

function buildFixture({ orderCount = 6, planSuffix = "A", inputSuffix = "BASE", routeCount = 2 } = {}) {
  const depot = { id: "DEPOT-01", name: "Synthetic Depot", address: "Synthetic Depot Address", lon: 121.36, lat: 31.18 };
  const vehicles = Array.from({ length: Math.max(routeCount, 4) }, (_, index) => ({
    id: `VEH-${index + 1}`,
    vehicleId: `VEH-${index + 1}`,
    name: `Synthetic Vehicle ${index + 1}`,
    type: "van",
    availableDate: "2026-09-01",
    maxVolume: 20,
    maxWeight: 1000,
    start: "08:00",
    end: "18:00",
    fixedCost: 80 + index * 5,
    perKmCost: 4,
    perMinuteCost: 0.3,
    perStopCost: 6,
    emissionFactor: 0.18,
    sourceVehicleId: `VEH-${index + 1}`,
    isVirtual: false,
    enabled: true,
  }));
  const orders = Array.from({ length: orderCount }, (_, index) => ({
    id: `ORDER-${String(index + 1).padStart(3, "0")}`,
    code: `STORE-${String(index + 1).padStart(3, "0")}`,
    name: `Synthetic Stop ${index + 1}`,
    address: `Synthetic Address ${index + 1}`,
    date: "2026-09-01",
    lon: 121.32 + (index % 8) * 0.012,
    lat: 31.14 + (index % 5) * 0.014,
    count: 10 + index,
    volume: 2,
    weight: 0,
    serviceMin: 10,
    twStart: index === 1 ? "09:10" : "08:00",
    twEnd: index === 2 ? "09:35" : "17:30",
    priority: index % 3 === 0 ? "high" : index % 3 === 1 ? "medium" : "normal",
    priorityWeight: index % 3 === 0 ? 3 : index % 3 === 1 ? 2 : 1,
    prioritySource: "mapped",
    orderType: "",
    requiredVehicleType: "",
  }));
  const inputHash = `sha256:input-${inputSuffix}`;
  const scenario = {
    planningMode: "SINGLE_DAY",
    scenarioId: `SCN-${inputSuffix}`,
    contentHash: `sha256:content-${inputSuffix}`,
    inputHash,
    planningDate: "2026-09-01",
    depot,
    vehicles,
    orders,
    constraints: {
      singleTrip: true, maxWaitingMinutes: 120, workStart: "08:00", workEnd: "18:00", maxOrders: 500,
      maxSolveSeconds: 45, allowUnassigned: true, capacityScale: 1000, weightScale: 1000,
      maxStops: 500, maxRouteMinutes: 600, shiftExtensionMinutes: 0,
    },
    assumptions: {
      roadDistanceFactor: 1.35, averageSpeedKmh: 40, defaultServiceMin: 10,
      costModelVersion: "stct-cost-v1", emissionModelVersion: "stct-emission-v1", priorityMappingVersion: "priority-map-v1",
      missingVehicleDatePolicy: "blank-means-daily", missingTimeWindowPolicy: "reject-order",
      overnightPolicy: "end-before-start-means-next-day", distanceModel: "haversine-road-factor",
      roadMetersRounding: "half-up", travelMinutesRounding: "ceil", costMinuteBasis: "driving",
      defaultEmissionFactor: 0.192, lowUtilizationThreshold: 35,
      balancedWeightUsedVehicles: 20, balancedWeightDistance: 20, balancedWeightCost: 20,
      balancedWeightCarbon: 15, balancedWeightLatestEnd: 15, balancedWeightUtilization: 10,
    },
    assumptionsSnapshot: {
      averageSpeedKmh: 40,
      roadDistanceFactor: 1.35,
      maxWaitingMinutes: 120,
      maxRouteMinutes: 600,
      shiftExtensionMinutes: 0,
    },
    constraintsSnapshot: { workStart: "08:00", workEnd: "18:00", maxWaitingMinutes: 120, lunchStart: "12:00", lunchEnd: "13:00" },
  };
  const routeAssignments = Array.from({ length: routeCount }, () => []);
  orders.forEach((order, index) => routeAssignments[index % routeCount].push(order));
  const routes = [];
  const routeFeatures = [];
  const stopFeatures = [];
  routeAssignments.forEach((assigned, routeIndex) => {
    const routeId = `R-${routeIndex + 1}`;
    const vehicleId = vehicles[routeIndex].id;
    let priorDeparture = minutes("08:00");
    const coordinates = [[depot.lon, depot.lat]];
    let volume = 0;
    assigned.forEach((order, stopIndex) => {
      const travelMin = 18 + (stopIndex % 3) * 4;
      const rawArrival = priorDeparture + travelMin;
      const windowStart = minutes(order.twStart);
      const serviceStart = Math.max(rawArrival, windowStart);
      const departure = serviceStart + order.serviceMin;
      stopFeatures.push(stop(routeId, vehicleId, order, stopIndex + 1, rawArrival, serviceStart, departure, travelMin));
      coordinates.push([order.lon, order.lat]);
      volume += order.volume;
      priorDeparture = departure;
    });
    const returnMinutes = priorDeparture + 20;
    coordinates.push([depot.lon, depot.lat]);
    const route = {
      routeId,
      vehicleId,
      vehicleName: vehicles[routeIndex].name,
      orderIds: assigned.map((order) => order.id),
      orders: assigned.length,
      stops: assigned.length,
      volume,
      weight: 0,
      maxVolume: vehicles[routeIndex].maxVolume,
      maxWeight: vehicles[routeIndex].maxWeight,
      volumeUtilization: volume / vehicles[routeIndex].maxVolume * 100,
      weightUtilization: 0,
      roadMeters: assigned.length * 8000,
      km: assigned.length * 8,
      startMinutes: minutes("08:00"),
      returnMinutes,
      start: "08:00",
      end: `${String(Math.floor(returnMinutes / 60)).padStart(2, "0")}:${String(returnMinutes % 60).padStart(2, "0")}`,
      estimatedCost: 100 + assigned.length * 35,
      estimatedCo2: assigned.length * 1.44,
      color: routeIndex === 0 ? "#003b79" : "#e60012",
    };
    routes.push(route);
    routeFeatures.push({ type: "Feature", properties: { ...route }, geometry: { type: "LineString", coordinates } });
  });
  const assigned = orders.length;
  const metrics = {
    assigned,
    unassigned: 0,
    blocked: 0,
    servicePriorityScore: orders.reduce((sum, order) => sum + order.priorityWeight, 0),
    usedVehicles: routes.length,
    vehicles: routes.length,
    routes: routes.length,
    orders: assigned,
    stops: assigned,
    estimatedRoadKm: routes.reduce((sum, route) => sum + route.km, 0),
    latestEndMinutes: Math.max(...routes.map((route) => route.returnMinutes)),
    latestEnd: [...routes].sort((a, b) => b.returnMinutes - a.returnMinutes)[0].end,
    totalCost: routes.reduce((sum, route) => sum + route.estimatedCost, 0),
    totalCO2: routes.reduce((sum, route) => sum + route.estimatedCo2, 0),
    serviceRate: 100,
    utilizationScore: routes.reduce((sum, route) => sum + route.volumeUtilization, 0) / routes.length,
    changeCount: 0,
  };
  const planHash = `sha256:plan-${planSuffix}`;
  const plan = {
    planId: `PLAN-${planSuffix}`,
    scenarioId: scenario.scenarioId,
    contentHash: scenario.contentHash,
    inputHash,
    requestHash: `sha256:request-${planSuffix}`,
    planHash,
    manualRevision: 0,
    routes,
    routeGeoJson: { type: "FeatureCollection", features: routeFeatures },
    stopGeoJson: { type: "FeatureCollection", features: stopFeatures },
    unassignedOrderIds: [],
    blockedOrderIds: [],
    unassignedOrders: [],
    blockedOrders: [],
    metrics: { ...metrics },
    verification: {
      status: "PASS",
      computedPlanHash: planHash,
      recomputedMetrics: { ...metrics },
      hardViolations: [],
      metricMismatches: [],
    },
    meta: { engine: "OR-Tools", source: "Synthetic Fixture", goal: "balanced", manualAdjustmentAudit: [] },
  };
  return { scenario, plan };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = { buildFixture, clone, minutes };
