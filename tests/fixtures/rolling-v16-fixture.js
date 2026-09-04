"use strict";

const Fixture = require("../../road-network-fixture-v16.js");
const Providers = require("../../routing-provider-registry-v16.js");
const Integrity = require("../../integrity-hash-v151.js");
const Rolling = require("../../rolling-plan-v16.js");

async function create(overrides = {}) {
  const graph = Fixture.createFixture();
  const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const point = (pointId, nodeId) => ({ pointId, lon: nodes.get(nodeId).lon, lat: nodes.get(nodeId).lat });
  const points = [point("V1_START", "DEPOT"), point("V2_START", "H"), point("DEPOT_END", "DEPOT"), point("O2", "B"), point("O3", "C"), point("O4", "ZONE_B")];
  const registry = Providers.createRegistry();
  const provider = registry.get("SYNTHETIC_ROAD_FIXTURE");
  const matrix = await provider.matrix({
    schemaVersion: "stct-routing-request-v1.6",
    providerId: provider.id,
    profile: "light-truck",
    points,
    distanceUnit: "km",
    durationUnit: "minutes",
    snapToleranceMeters: 120,
  });
  const baseScenario = {
    schemaVersion: "stct-scenario-v1.6-test",
    scenarioId: "ROLLING-FIXTURE",
    planningDate: "2026-08-31",
    depot: { id: "DEPOT_END", lon: nodes.get("DEPOT").lon, lat: nodes.get("DEPOT").lat },
    orders: [
      { id: "O1", lon: nodes.get("A").lon, lat: nodes.get("A").lat, volume: 1, serviceMin: 5, twStart: 480, twEnd: 900 },
      { id: "O2", lon: nodes.get("B").lon, lat: nodes.get("B").lat, volume: 1, serviceMin: 5, twStart: 500, twEnd: 1000, priorityWeight: 3 },
      { id: "O3", lon: nodes.get("C").lon, lat: nodes.get("C").lat, volume: 1, serviceMin: 5, twStart: 500, twEnd: 1000, priorityWeight: 2 },
      { id: "O4", lon: nodes.get("ZONE_B").lon, lat: nodes.get("ZONE_B").lat, volume: 1, serviceMin: 5, twStart: 500, twEnd: 1100, priorityWeight: 1 },
    ],
    vehicles: [
      { id: "V1", maxVolume: 8, start: 480, endPointId: "DEPOT_END" },
      { id: "V2", maxVolume: 8, start: 480, endPointId: "DEPOT_END" },
    ],
    constraints: { volumeOnly: true },
    assumptions: { source: "SYNTHETIC_TEST_FIXTURE" },
  };
  const basePlan = {
    schemaVersion: "stct-plan-v1.6-test",
    planId: "PLAN-BASE",
    revision: 7,
    routes: [
      { routeId: "R1", vehicleId: "V1", orderIds: ["O1", "O2", "O3"], etaByOrder: { O1: 490, O2: 520, O3: 550 } },
      { routeId: "R2", vehicleId: "V2", orderIds: ["O4"], etaByOrder: { O4: 620 } },
    ],
  };
  basePlan.planHash = Integrity.hashValue({ planId: basePlan.planId, revision: basePlan.revision, routes: basePlan.routes });
  const contextInput = {
    baseInputHash: Integrity.hashValue({ scenarioId: baseScenario.scenarioId }),
    currentPlanHash: basePlan.planHash,
    executionRunHash: Integrity.hashValue({ run: "RUN-1" }),
    executionStateHash: Integrity.hashValue({ state: "AT-CUTOFF" }),
    cutoffLogicalMinute: 510,
    vehicleStates: [
      { vehicleId: "V1", status: "IN_SERVICE", currentLogicalMinute: 510, currentCoordinate: [nodes.get("DEPOT").lon, nodes.get("DEPOT").lat], currentRoadNodeId: "V1_START", currentLoad: 1, completedStopIds: ["O1", "O1"], activeStopId: "O2", remainingLoadedOrderIds: ["O3"], remainingShiftMinutes: 540, atDepot: false },
      { vehicleId: "V2", status: "AVAILABLE", currentLogicalMinute: 510, currentCoordinate: [nodes.get("H").lon, nodes.get("H").lat], currentRoadNodeId: "V2_START", currentLoad: 0, completedStopIds: [], activeStopId: "", remainingLoadedOrderIds: [], remainingShiftMinutes: 540, atDepot: false },
    ],
    completedStopIds: ["O1", "O1"],
    activeStopIds: ["O2"],
    failedStopIds: [],
    remainingOrderIds: ["O2", "O3", "O4"],
    cancelledOrderIds: [],
    loadedOrderAssignments: [{ orderId: "O3", vehicleId: "V1", loaded: true }],
    lockedRouteIds: ["R1"],
    fixedRoutePrefixes: [{ routeId: "R1", vehicleId: "V1", stopIds: ["O1"] }, { routeId: "R2", vehicleId: "V2", stopIds: [] }],
    transferPolicy: "LOCK_LOADED_ORDERS_TO_VEHICLE",
    matrixHash: matrix.matrixHash,
    providerProvenance: matrix.providerProvenance,
    ...(overrides.context || {}),
  };
  const context = Rolling.normalizeContext(contextInput);
  const scenario = Rolling.deriveRemainingScenario(baseScenario, context, { endPointByVehicle: { V1: "DEPOT_END", V2: "DEPOT_END" }, failedStopPolicy: overrides.failedStopPolicy || "REMOVE", generatedAt: "2026-08-31T00:00:00.000Z" });
  return { graph, nodes, points, provider, matrix, baseScenario, basePlan, contextInput, context, scenario };
}

module.exports = { create };
