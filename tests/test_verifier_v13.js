#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const clone = (value) => JSON.parse(JSON.stringify(value));
global.window = { crypto: globalThis.crypto };
vm.runInThisContext(fs.readFileSync(path.join(root, "canonical.js"), "utf8"), { filename: "canonical.js" });
const contract = JSON.parse(fs.readFileSync(path.join(root, "shared", "planning-contract-v13.json"), "utf8"));
window.STCTCanonical.configure(contract);
vm.runInThisContext(fs.readFileSync(path.join(root, "verifier.js"), "utf8"), { filename: "verifier.js" });
const canonical = window.STCTCanonical;
const verifier = window.STCTVerifier;

function sourceScenario(options = {}) {
  const date = options.date || "2026-05-01";
  const orders = options.orders || [
    { id: "O1", code: "O1", name: "一号店", address: "A", date, lon: 0, lat: 0, count: 1, volume: 4, weight: 4, serviceMin: 0, twStart: "09:00", twEnd: "18:00", priority: "high", priorityWeight: 3, prioritySource: "mapped", orderType: "", requiredVehicleType: "" },
    { id: "O2", code: "O2", name: "二号店", address: "B", date, lon: 0.001, lat: 0, count: 1, volume: 6, weight: 6, serviceMin: 0, twStart: "09:00", twEnd: "18:00", priority: "normal", priorityWeight: 1, prioritySource: "mapped", orderType: "", requiredVehicleType: "" },
  ];
  const vehicles = options.vehicles || [
    { id: "V1", name: "车一", type: "4.2m", availableDate: date, maxVolume: 10, maxWeight: 10, start: "09:00", end: "18:00", fixedCost: 100, perKmCost: 2, perMinuteCost: 0.5, perStopCost: 5, emissionFactor: 0.2, sourceVehicleId: "V1", isVirtual: false, enabled: true },
    { id: "V2", name: "车二", type: "4.2m", availableDate: "", maxVolume: 10, maxWeight: 10, start: "09:00", end: "18:00", fixedCost: 100, perKmCost: 2, perMinuteCost: 0.5, perStopCost: 5, emissionFactor: 0.2, sourceVehicleId: "V2", isVirtual: false, enabled: true },
  ];
  return {
    contractVersion: contract.contractVersion,
    canonicalVersion: contract.canonicalVersion,
    planningMode: "SINGLE_DAY",
    planningDate: date,
    depot: { id: "D1", name: "仓库", address: "D", lon: 0, lat: 0 },
    orders,
    vehicles,
    constraints: { singleTrip: true, maxWaitingMinutes: 90, workStart: "09:00", workEnd: "18:00", maxOrders: 500, maxSolveSeconds: 45, allowUnassigned: true, capacityScale: 1000, weightScale: 1000, maxStops: 500, maxRouteMinutes: 1440, shiftExtensionMinutes: 0 },
    assumptions: { roadDistanceFactor: 1, averageSpeedKmh: 60, defaultServiceMin: 0, costModelVersion: "stct-cost-v1", emissionModelVersion: "stct-emission-v1", priorityMappingVersion: "priority-map-v1", missingVehicleDatePolicy: "blank-means-daily", missingTimeWindowPolicy: "reject-order", overnightPolicy: "end-before-start-means-next-day", distanceModel: "haversine-road-factor", roadMetersRounding: "half-up", travelMinutesRounding: "ceil", costMinuteBasis: "driving", defaultEmissionFactor: 0.192, lowUtilizationThreshold: 35, balancedWeightUsedVehicles: 20, balancedWeightDistance: 20, balancedWeightCost: 20, balancedWeightCarbon: 15, balancedWeightLatestEnd: 15, balancedWeightUtilization: 10 },
  };
}

async function scenario(options = {}) {
  const identity = await canonical.scenarioIdentity(sourceScenario(options));
  return { ...identity.scenario, scenarioId: `SCN-${identity.inputHash.slice(-12)}`, contentHash: identity.contentHash, inputHash: identity.inputHash };
}

async function planFor(current, routeSpecs, unassignedOrderIds = [], blockedOrderIds = []) {
  const authority = {
    routes: routeSpecs.map((route) => ({ routeId: route.routeId, vehicleId: route.vehicleId, orderIds: [...route.orderIds] })),
    unassignedOrderIds: [...unassignedOrderIds],
    blockedOrderIds: [...blockedOrderIds],
    manualRevision: 0,
    parentPlanHash: "",
  };
  const planHash = (await canonical.planIdentity(current.inputHash, authority)).planHash;
  const skeleton = {
    contractVersion: current.contractVersion,
    canonicalVersion: current.canonicalVersion,
    contentHash: current.contentHash,
    inputHash: current.inputHash,
    requestHash: `sha256:${"1".repeat(64)}`,
    planHash,
    serverHashVerified: true,
    routes: clone(authority.routes),
    unassignedOrderIds: [...unassignedOrderIds],
    blockedOrderIds: [...blockedOrderIds],
    manualRevision: 0,
  };
  const rebuilt = verifier.recomputePlan(skeleton, current).plan;
  rebuilt.reportedMetrics = clone(rebuilt.metrics);
  rebuilt.planHash = planHash;
  return rebuilt;
}

function requested(plan, goal) {
  plan.meta = { ...(plan.meta || {}), requestedGoal: goal, goal };
  plan.requestedGoals = [goal];
  return plan;
}

function codes(result) {
  return new Set([...(result.hardViolations || []), ...(result.metricMismatches || [])].map((row) => row.code));
}

async function expectFailure(id, plan, current, expectedCode) {
  const result = await verifier.verify(plan, current);
  assert.strictEqual(result.status, "FAIL", id);
  assert(codes(result).has(expectedCode), `${id}: expected ${expectedCode}; got ${[...codes(result)].join(",")}`);
  return { id, expected: "FAIL", actual: result.status, code: expectedCode };
}

async function expectPass(id, plan, current) {
  const result = await verifier.verify(plan, current);
  assert.strictEqual(result.status, "PASS", `${id}: ${JSON.stringify(result.hardViolations)} ${JSON.stringify(result.metricMismatches)}`);
  return { id, expected: "PASS", actual: result.status, warnings: result.warningCount };
}

async function main() {
  const results = [];
  const base = await scenario();
  const valid = await planFor(base, [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1", "O2"] }]);
  results.push(await expectPass("simple_feasible", valid, base));

  const noCache = clone(valid);
  delete noCache.stopGeoJson;
  delete noCache.routeGeoJson;
  delete noCache.depot;
  results.push(await expectPass("minimal_authority_without_display_cache", noCache, base));

  const coordinate = clone(valid);
  coordinate.stopGeoJson.features[1].geometry.coordinates = [0, 0];
  results.push(await expectFailure("coordinate_tamper", coordinate, base, "STOP_COORDINATE_MISMATCH"));

  const duplicateVehicle = await planFor(base, [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1"] }, { routeId: "R2", vehicleId: "V1", orderIds: ["O2"] }]);
  results.push(await expectFailure("duplicate_vehicle", duplicateVehicle, base, "DUPLICATE_VEHICLE_USE"));

  const duplicateRoute = clone(duplicateVehicle);
  duplicateRoute.routes[1].routeId = "R1";
  results.push(await expectFailure("duplicate_route", duplicateRoute, base, "DUPLICATE_ROUTE_ID"));

  const duplicateWithin = await planFor(base, [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1", "O1"] }], ["O2"]);
  results.push(await expectFailure("duplicate_order_in_route", duplicateWithin, base, "DUPLICATE_ASSIGNED_ORDER"));

  const duplicateAcross = await planFor(base, [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1"] }, { routeId: "R2", vehicleId: "V2", orderIds: ["O1"] }], ["O2"]);
  results.push(await expectFailure("duplicate_order_across_routes", duplicateAcross, base, "DUPLICATE_ASSIGNED_ORDER"));

  const unknownOrder = clone(valid);
  unknownOrder.routes[0].orderIds[1] = "OUTSIDE";
  results.push(await expectFailure("unknown_order", unknownOrder, base, "UNKNOWN_ORDER_ID"));

  const unknownVehicle = clone(valid);
  unknownVehicle.routes[0].vehicleId = "OUTSIDE";
  results.push(await expectFailure("unknown_vehicle", unknownVehicle, base, "UNKNOWN_VEHICLE_ID"));

  const parentRoute = clone(valid);
  parentRoute.stopGeoJson.features[0].properties.routeId = "OTHER";
  results.push(await expectFailure("stop_parent_route", parentRoute, base, "STOP_PARENT_ROUTE_MISMATCH"));

  const parentVehicle = clone(valid);
  parentVehicle.stopGeoJson.features[0].properties.vehicleId = "V2";
  results.push(await expectFailure("stop_parent_vehicle", parentVehicle, base, "STOP_PARENT_VEHICLE_MISMATCH"));

  const depotTamper = clone(valid);
  depotTamper.depot = { ...base.depot, lon: 1 };
  results.push(await expectFailure("depot_tamper", depotTamper, base, "DEPOT_COORDINATE_MISMATCH"));

  const exactCapacity = await scenario({ orders: [sourceScenario().orders[0], { ...sourceScenario().orders[1], volume: 6, weight: 6 }] });
  results.push(await expectPass("exact_capacity", await planFor(exactCapacity, [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1", "O2"] }]), exactCapacity));

  const volumeOver = await scenario({ orders: [sourceScenario().orders[0], { ...sourceScenario().orders[1], volume: 6.001, weight: 6 }] });
  results.push(await expectFailure("volume_over_by_one_unit", await planFor(volumeOver, [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1", "O2"] }]), volumeOver, "ROUTE_VOLUME_CAPACITY_EXCEEDED"));

  const weightOver = await scenario({ orders: [sourceScenario().orders[0], { ...sourceScenario().orders[1], volume: 6, weight: 6.001 }] });
  results.push(await expectFailure("weight_over_by_one_unit", await planFor(weightOver, [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1", "O2"] }]), weightOver, "ROUTE_WEIGHT_CAPACITY_EXCEEDED"));

  const wait90Source = sourceScenario();
  wait90Source.orders = [{ ...wait90Source.orders[0], twStart: "10:30", twEnd: "18:00" }];
  const wait90 = await scenario({ orders: wait90Source.orders });
  results.push(await expectPass("wait_exactly_90", await planFor(wait90, [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1"] }]), wait90));

  const wait91 = await scenario({ orders: [{ ...wait90Source.orders[0], twStart: "10:31" }] });
  results.push(await expectFailure("wait_91", await planFor(wait91, [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1"] }]), wait91, "MAX_WAIT_EXCEEDED"));

  const wait180 = await scenario({ orders: [{ ...wait90Source.orders[0], twStart: "12:00" }] });
  results.push(await expectFailure("wait_180", await planFor(wait180, [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1"] }]), wait180, "MAX_WAIT_EXCEEDED"));

  const midnightOrder = { ...sourceScenario().orders[0], twStart: "19:00", twEnd: "01:00" };
  const midnightVehicle = { ...sourceScenario().vehicles[0], start: "18:00", end: "02:00" };
  const midnight = await scenario({ orders: [midnightOrder], vehicles: [midnightVehicle] });
  results.push(await expectPass("cross_midnight_feasible", await planFor(midnight, [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1"] }]), midnight));

  const shiftOrder = { ...sourceScenario().orders[0], serviceMin: 10 };
  const shiftVehicle = { ...sourceScenario().vehicles[0], end: "09:05" };
  const shift = await scenario({ orders: [shiftOrder], vehicles: [shiftVehicle] });
  results.push(await expectFailure("shift_end_violation", await planFor(shift, [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1"] }]), shift, "SHIFT_END_VIOLATION"));

  const inputMismatch = clone(valid);
  inputMismatch.inputHash = `sha256:${"0".repeat(64)}`;
  results.push(await expectFailure("plan_input_hash_mismatch", inputMismatch, base, "PLAN_INPUT_HASH_MISMATCH"));

  const contractMismatch = clone(valid);
  contractMismatch.contractVersion = "wrong";
  results.push(await expectFailure("plan_contract_mismatch", contractMismatch, base, "PLAN_CONTRACT_MISMATCH"));

  for (const [id, metric] of [["cost_tamper", "totalCost"], ["carbon_tamper", "totalCO2"], ["distance_tamper", "roadMeters"]]) {
    const tampered = clone(valid);
    tampered.reportedMetrics[metric] += 100;
    results.push(await expectFailure(id, tampered, base, "METRIC_MISMATCH"));
  }

  const conservation = clone(valid);
  conservation.unassignedOrderIds = ["O1"];
  results.push(await expectFailure("set_conservation", conservation, base, "ORDER_SET_CONSERVATION_FAILED"));

  const repeatA = await verifier.verify(valid, base);
  const repeatB = await verifier.verify(valid, base);
  assert.deepStrictEqual(repeatA.recomputedMetrics, repeatB.recomputedMetrics);
  assert.strictEqual(repeatA.recomputedMetrics.changeCount, 0, "base candidate changeCount is verifier-owned");
  results.push({ id: "repeat_verification", expected: "stable", actual: "stable" });

  const poolOrders = [
    { ...sourceScenario().orders[0], id: "P1", code: "P1", priorityWeight: 3, volume: 1, weight: 1, lon: 0.001 },
    { ...sourceScenario().orders[1], id: "P2", code: "P2", priorityWeight: 2, volume: 1, weight: 1, lon: 0.002 },
    { ...sourceScenario().orders[1], id: "P3", code: "P3", priorityWeight: 1, volume: 1, weight: 1, lon: 0.003 },
  ];
  const baseVehicle = sourceScenario().vehicles[0];
  const poolVehicles = [
    { ...baseVehicle, id: "VH", name: "High cost", maxVolume: 10, maxWeight: 10, fixedCost: 300, perKmCost: 8, emissionFactor: 0.5 },
    { ...baseVehicle, id: "VL", name: "Low cost", maxVolume: 10, maxWeight: 10, fixedCost: 30, perKmCost: 1, emissionFactor: 0.05 },
    { ...baseVehicle, id: "VM", name: "Medium", maxVolume: 10, maxWeight: 10, fixedCost: 80, perKmCost: 3, emissionFactor: 0.2 },
  ];
  const poolScenario = await scenario({ orders: poolOrders, vehicles: poolVehicles });
  const highCost = requested(await planFor(poolScenario, [{ routeId: "RH", vehicleId: "VH", orderIds: ["P1", "P2", "P3"] }]), "vehicles");
  const lowCost = requested(await planFor(poolScenario, [{ routeId: "RL", vehicleId: "VL", orderIds: ["P1", "P2", "P3"] }]), "cost");
  const reordered = requested(await planFor(poolScenario, [{ routeId: "RM", vehicleId: "VM", orderIds: ["P3", "P1", "P2"] }]), "distance");
  const split = requested(await planFor(poolScenario, [{ routeId: "RS1", vehicleId: "VL", orderIds: ["P1", "P2"] }, { routeId: "RS2", vehicleId: "VM", orderIds: ["P3"] }]), "utilization");
  const lowerService = requested(await planFor(poolScenario, [{ routeId: "RLOW", vehicleId: "VL", orderIds: ["P1"] }], ["P2", "P3"]), "distance");
  const duplicate = clone(lowCost);
  duplicate.meta.requestedGoal = "carbon";
  duplicate.requestedGoals = ["carbon"];
  const failed = requested(await planFor(poolScenario, [{ routeId: "RFAIL", vehicleId: "VH", orderIds: ["P2", "P1", "P3"] }]), "balanced");
  failed.planId = "FAILED-METRIC";
  failed.reportedMetrics.totalCost += 100;
  const ranked = await verifier.rankCandidatePool([highCost, lowCost, reordered, split, lowerService, duplicate, failed], poolScenario);
  assert.strictEqual(ranked.invariant.status, "PASS");
  assert.strictEqual(ranked.candidates.length, 6);
  assert.strictEqual(ranked.servicePeers.length, 4);
  const lowRanked = ranked.candidates.find((plan) => plan.planHash === lowerService.planHash);
  assert.deepStrictEqual(lowRanked.labels, []);
  const failedRanked = ranked.candidates.find((plan) => plan.planId === "FAILED-METRIC");
  assert.deepStrictEqual(failedRanked.labels, []);
  assert(ranked.candidates.find((plan) => plan.planHash === lowCost.planHash).requestedGoals.includes("carbon"));
  const objectiveChecks = {
    distance: ["estimatedRoadKm", Math.min], cost: ["totalCost", Math.min], carbon: ["totalCO2", Math.min],
    vehicles: ["usedVehicles", Math.min], utilization: ["utilizationScore", Math.max], balanced: ["balancedPoolScore", Math.max],
  };
  Object.entries(objectiveChecks).forEach(([label, [metric, chooser]]) => {
    const target = chooser(...ranked.servicePeers.map((plan) => plan.metrics[metric]));
    assert(ranked.assignments[label].every((plan) => Math.abs(plan.metrics[metric] - target) <= (label === "vehicles" ? 0 : 0.1)));
  });
  results.push({ id: "candidate_pool_service_first_labels", expected: "PASS", actual: "PASS", deduped: ranked.candidates.length });

  const pressureScenario = await scenario({
    orders: [{ ...sourceScenario().orders[0], id: "C1", code: "C1", volume: 6, weight: 1 }, { ...sourceScenario().orders[1], id: "C2", code: "C2", volume: 6, weight: 1 }],
    vehicles: [{ ...sourceScenario().vehicles[0], id: "CV1", maxVolume: 10, maxWeight: 10 }],
  });
  const pressurePlan = await planFor(pressureScenario, [{ routeId: "CR1", vehicleId: "CV1", orderIds: ["C1"] }], ["C2"]);
  pressurePlan.engine = "OR-Tools";
  const pressure = verifier.diagnostics(pressurePlan, pressureScenario);
  assert(pressure.scenarioReasons.some((row) => row.reasonCode === "GLOBAL_VOLUME_CAPACITY_SHORTFALL"));
  assert.strictEqual(pressure.orderReasons[0].confidence, "probable");
  results.push({ id: "scenario_vs_order_diagnosis", expected: "probable", actual: pressure.orderReasons[0].confidence });

  const impossibleScenario = await scenario({ orders: [{ ...sourceScenario().orders[0], id: "BIG", code: "BIG", volume: 11, weight: 1 }], vehicles: [{ ...sourceScenario().vehicles[0], id: "IV1", maxVolume: 10, maxWeight: 10 }] });
  const impossiblePlan = await planFor(impossibleScenario, [], ["BIG"]);
  const impossible = verifier.diagnostics(impossiblePlan, impossibleScenario);
  assert.strictEqual(impossible.orderReasons[0].reasonCode, "ORDER_EXCEEDS_ALL_VEHICLES_VOLUME");
  assert.strictEqual(impossible.orderReasons[0].confidence, "deterministic");
  results.push({ id: "deterministic_order_diagnosis", expected: "deterministic", actual: impossible.orderReasons[0].confidence });

  process.stdout.write(`${JSON.stringify({ status: "PASS", fixtureCount: results.length, results }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
