#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = {};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "verifier.js"), "utf8"), { filename: "verifier.js" });
const verifier = window.STCTVerifier;

const scenario = {
  scenarioId: "SCN-VERIFIER-FIXTURE",
  inputHash: "fixture-verifier-hash",
  planningDate: "2026-01-01",
  orderIds: ["A", "B", "C"],
  orders: [
    { id: "A", _scenarioOrderKey: "A", lon: 120.01, lat: 30.0, volume: 2, weight: 1, count: 1, twStart: "09:00", twEnd: "18:00", serviceMin: 5 },
    { id: "B", _scenarioOrderKey: "B", lon: 120.04, lat: 30.0, volume: 2, weight: 1, count: 1, twStart: "09:00", twEnd: "18:00", serviceMin: 5 },
    { id: "C", _scenarioOrderKey: "C", lon: 120.02, lat: 30.03, volume: 2, weight: 1, count: 1, twStart: "09:00", twEnd: "18:00", serviceMin: 5 },
  ],
  vehicleIds: ["V-HIGH", "V-LOW", "V-MID"],
  vehicles: [
    { vehicleId: "V-HIGH", availableDate: "2026-01-01", maxVolume: 12, maxWeight: 12, start: "09:00", end: "18:00", fixedCost: 300, perKmCost: 8, perMinuteCost: 0.5, perStopCost: 8, emissionFactor: 0.5 },
    { vehicleId: "V-LOW", availableDate: "2026-01-01", maxVolume: 8, maxWeight: 8, start: "09:00", end: "18:00", fixedCost: 30, perKmCost: 1, perMinuteCost: 0.1, perStopCost: 2, emissionFactor: 0.05 },
    { vehicleId: "V-MID", availableDate: "2026-01-01", maxVolume: 8, maxWeight: 8, start: "09:00", end: "18:00", fixedCost: 80, perKmCost: 3, perMinuteCost: 0.2, perStopCost: 4, emissionFactor: 0.2 },
  ],
  depot: { id: "DEPOT", lon: 120.0, lat: 30.0 },
  constraintsSnapshot: { workStart: "09:00", workEnd: "18:00", averageSpeedKmh: 30, defaultServiceMinutes: 5, roadDistanceFactor: 1.0, shiftExtensionMinutes: 0 },
  assumptionsSnapshot: {
    roadDistanceFactor: 1.0,
    averageSpeedKmh: 30,
    defaultServiceMinutes: 5,
    lowUtilizationThreshold: 35,
    costModel: { currency: "CNY", fixedVehicleCost: 120, perKm: 4.8, perMinute: 0.35, perStop: 8 },
    carbonModel: { defaultVehicleFactor: 0.192 },
    balancedWeights: { usedVehicles: 20, estimatedRoadKm: 20, totalCost: 20, totalCO2: 15, latestEnd: 15, utilizationScore: 10 },
  },
};

function feature(orderId, routeId, vehicleId, seq) {
  const order = scenario.orders.find((row) => row.id === orderId);
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [order.lon, order.lat] },
    properties: { routeId, vehicleId, orderId, code: orderId, seq, count: 1, volume: order.volume, weight: order.weight, serviceMin: order.serviceMin },
  };
}

function candidate(name, routes, requestedGoal) {
  const skeleton = {
    scenarioId: scenario.scenarioId,
    inputHash: scenario.inputHash,
    routes: routes.map((route) => ({ routeId: route.routeId, vehicleId: route.vehicleId, color: "#2563eb" })),
    routeGeoJson: { type: "FeatureCollection", features: [] },
    stopGeoJson: {
      type: "FeatureCollection",
      features: routes.flatMap((route) => route.orders.map((id, index) => feature(id, route.routeId, route.vehicleId, index + 1))),
    },
    blockedOrders: [],
    unassignedOrders: [],
    meta: { requestedGoal, goal: requestedGoal, sourceName: name },
  };
  const recomputed = verifier.recomputePlan(skeleton, scenario).plan;
  recomputed.meta = { ...recomputed.meta, requestedGoal, goal: requestedGoal, sourceName: name };
  recomputed.scenarioId = scenario.scenarioId;
  recomputed.inputHash = scenario.inputHash;
  return recomputed;
}

const sourcePlans = [
  candidate("high-one", [{ routeId: "R-HIGH", vehicleId: "V-HIGH", orders: ["A", "B", "C"] }], "vehicles"),
  candidate("low-one", [{ routeId: "R-LOW", vehicleId: "V-LOW", orders: ["A", "B", "C"] }], "cost"),
  candidate("mid-one-reordered", [{ routeId: "R-MID", vehicleId: "V-MID", orders: ["B", "A", "C"] }], "distance"),
  candidate("split", [
    { routeId: "R-S1", vehicleId: "V-LOW", orders: ["A", "B"] },
    { routeId: "R-S2", vehicleId: "V-MID", orders: ["C"] },
  ], "utilization"),
];

const ranked = verifier.rankCandidatePool(sourcePlans, scenario);
assert.strictEqual(ranked.invariant.status, "PASS");
assert(ranked.candidates.length >= 4);
assert(ranked.candidates.every((plan) => plan.verification.status === "PASS"));
assert(ranked.candidates.every((plan) => plan.conservation.balanced));

const peers = ranked.servicePeers;
const checks = {
  distance: ["estimatedRoadKm", Math.min, 0.1],
  cost: ["totalCost", Math.min, 0.1],
  carbon: ["totalCO2", Math.min, 0.1],
  vehicles: ["usedVehicles", Math.min, 0],
  utilization: ["utilizationScore", Math.max, 0.1],
  balanced: ["balancedScore", Math.max, 0.1],
};
Object.entries(checks).forEach(([label, [metric, chooser, tolerance]]) => {
  const target = chooser(...peers.map((plan) => plan.metrics[metric]));
  assert(ranked.assignments[label].length > 0, `${label} has no assignment`);
  ranked.assignments[label].forEach((plan) => {
    assert(Math.abs(plan.metrics[metric] - target) <= tolerance, `${label} was not assigned to the actual ${metric} optimum`);
    assert(plan.labels.includes(label));
  });
});

const metricTamper = JSON.parse(JSON.stringify(sourcePlans[0]));
metricTamper.metrics.totalDistance += 10;
assert.strictEqual(verifier.verify(metricTamper, scenario).status, "FAIL");
assert.strictEqual(verifier.verify(metricTamper, scenario).metricMismatchCount, 1);

const depotTamper = JSON.parse(JSON.stringify(sourcePlans[0]));
depotTamper.routeGeoJson.features[0].geometry.coordinates[0] = [121, 31];
assert(verifier.verify(depotTamper, scenario).violations.some((row) => row.code === "DEPOT_ROUND_TRIP_MISMATCH"));

const dateTamper = JSON.parse(JSON.stringify(scenario));
dateTamper.vehicles[0].availableDate = "2026-01-02";
assert(verifier.verify(sourcePlans[0], dateTamper).violations.some((row) => row.code === "VEHICLE_DATE_MISMATCH"));

const duplicateTamper = JSON.parse(JSON.stringify(sourcePlans[0]));
duplicateTamper.blockedOrders.push({ id: "A", reasonCode: "INVALID_DEMAND" });
assert(verifier.verify(duplicateTamper, scenario).violations.some((row) => row.code === "DUPLICATE_ASSIGNMENT"));

const adequacy = verifier.fleetAdequacy({
  ...scenario,
  orders: [
    { ...scenario.orders[0], volume: 6 },
    { ...scenario.orders[1], volume: 6 },
  ],
  vehicles: scenario.vehicles.slice(0, 2).map((vehicle) => ({ ...vehicle, maxVolume: 10 })),
});
assert.strictEqual(adequacy.volumeLowerBound, 2);
assert.strictEqual(adequacy.requiredLowerBound, 2);

console.log(JSON.stringify({
  status: "PASS",
  candidateCount: ranked.candidates.length,
  verifierStatuses: ranked.candidates.map((plan) => plan.verification.status),
  goalLinks: ranked.goalLinks,
  objectiveChecks: Object.keys(checks),
}, null, 2));
