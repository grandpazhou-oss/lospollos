#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(process.env.STCT_V12_ROOT || path.join(__dirname, ".."));
const optimizerUrl = process.env.STCT_V12_OPTIMIZER_URL || "http://127.0.0.1:19097/optimize";
const evidenceDir = process.env.STCT_BEFORE_EVIDENCE_DIR
  ? path.resolve(process.env.STCT_BEFORE_EVIDENCE_DIR)
  : null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function installBrowserStubs() {
  global.window = {
    STCT_CONFIG: {
      roadDistanceFactor: 1.35,
      averageSpeedKmh: 30,
      defaultServiceMinutes: 5,
      maxSolveSeconds: 45,
    },
    STCTUtils: {
      clone,
      timeToMinutes(value) {
        const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
        if (!match) return null;
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
      },
      normalizeCoordinate(row) {
        const lon = Number(row?.lon);
        const lat = Number(row?.lat);
        return {
          lon,
          lat,
          valid: Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90,
        };
      },
    },
    dispatchEvent() {},
  };
  global.document = { getElementById() { return null; } };
  global.CustomEvent = class CustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  };
}

function loadV12() {
  installBrowserStubs();
  ["optimizer.js", "verifier.js", "planning-v12.js"].forEach((file) => {
    vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file });
  });
  return { planning: window.STCTPlanning, optimizer: window.STCTOptimizer, verifier: window.STCTVerifier };
}

function simpleRaw() {
  return {
    depot: { id: "DEPOT", name: "Depot", lon: 120, lat: 30 },
    orders: [
      { id: "O1", code: "O1", date: "2026-01-01", lon: 120.1, lat: 30.1, count: 1, volume: 1, weight: 1, serviceMin: 5, twStart: "09:00", twEnd: "18:00", priority: "high" },
      { id: "O2", code: "O2", date: "2026-01-01", lon: 120.2, lat: 30.2, count: 1, volume: 1, weight: 1, serviceMin: 5, twStart: "09:00", twEnd: "18:00", priority: "normal" },
    ],
    vehicles: [
      { vehicleId: "V1", name: "V1", maxVolume: 10000, maxWeight: 10000, start: "09:00", end: "18:00", fixedCost: 0, perKmCost: 1, perMinuteCost: 0, perStopCost: 0, emissionFactor: 0.1 },
    ],
    constraints: { workStart: "09:00", workEnd: "18:00", maxWaitingMinutes: 90 },
  };
}

function verifierScenario(orders, vehicles) {
  return {
    scenarioId: "SCN-F0",
    inputHash: "fnv1a-f0fixture",
    planningDate: "2026-01-01",
    orderIds: orders.map((order) => order.id),
    orders: orders.map((order) => ({ ...order, _scenarioOrderKey: order.id })),
    vehicleIds: vehicles.map((vehicle) => vehicle.vehicleId),
    vehicles,
    depot: { id: "DEPOT", lon: 120, lat: 30 },
    constraintsSnapshot: {
      workStart: "09:00",
      workEnd: "18:00",
      averageSpeedKmh: 30,
      defaultServiceMinutes: 5,
      roadDistanceFactor: 1,
      maxWaitingMinutes: 90,
      shiftExtensionMinutes: 0,
    },
    assumptionsSnapshot: {
      roadDistanceFactor: 1,
      averageSpeedKmh: 30,
      defaultServiceMinutes: 5,
      costModel: { fixedVehicleCost: 0, perKm: 1, perMinute: 0, perStop: 0 },
      carbonModel: { defaultVehicleFactor: 0.1 },
    },
  };
}

function planSkeleton(scenario, routes) {
  return {
    scenarioId: scenario.scenarioId,
    inputHash: scenario.inputHash,
    routes: routes.map((route) => ({ routeId: route.routeId, vehicleId: route.vehicleId })),
    routeGeoJson: { type: "FeatureCollection", features: [] },
    stopGeoJson: {
      type: "FeatureCollection",
      features: routes.flatMap((route) => route.orders.map((id, index) => {
        const order = scenario.orders.find((row) => row.id === id);
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [order.lon, order.lat] },
          properties: {
            routeId: route.routeId,
            vehicleId: route.vehicleId,
            orderId: id,
            seq: index + 1,
            volume: order.volume,
            weight: order.weight,
            serviceMin: order.serviceMin,
          },
        };
      })),
    },
    blockedOrders: [],
    unassignedOrders: [],
    metrics: {},
  };
}

function recomputedPlan(verifier, scenario, routes) {
  const plan = verifier.recomputePlan(planSkeleton(scenario, routes), scenario).plan;
  plan.scenarioId = scenario.scenarioId;
  plan.inputHash = scenario.inputHash;
  return plan;
}

function workbookRaw() {
  const XLSX = require(path.join(root, "vendor", "xlsx", "xlsx.full.min.js"));
  const workbook = XLSX.read(fs.readFileSync(path.join(root, "templates", "laiyifen-202605-rawdata.xlsx")), { type: "buffer", cellDates: true });
  const rows = (name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "", raw: false });
  const orders = rows("Orders").map((row) => ({
    id: String(row["订单号"]).trim(),
    code: String(row["订单号"]).trim(),
    name: String(row["配送点名称"]).trim(),
    address: String(row["地址"]).trim(),
    date: String(row["配送日"]).trim(),
    lat: Number(row["纬度"]),
    lon: Number(row["经度"]),
    count: Number(row["件数"]),
    weight: Number(row["重量"]),
    volume: Number(row["体积"]),
    twStart: String(row["时间窗开始"]).trim(),
    twEnd: String(row["时间窗结束"]).trim(),
    serviceMin: Number(row["服务时间"]),
    priority: String(row["优先级"]).trim(),
  }));
  const vehicles = rows("Vehicles").map((row) => ({
    vehicleId: String(row["车辆ID"]).trim(),
    name: String(row["车辆名称"]).trim(),
    type: String(row["车型"]).trim(),
    maxWeight: Number(row["最大载重"]),
    maxVolume: Number(row["最大容积"]),
    start: String(row["可用开始"]).trim(),
    end: String(row["可用结束"]).trim(),
    availableDate: String(row["可用日期"]).trim(),
  }));
  const depotRow = rows("Depots")[0];
  return {
    orders,
    vehicles,
    depot: {
      id: String(depotRow["仓库ID"]).trim(),
      name: String(depotRow["仓库名称"]).trim(),
      address: String(depotRow["地址"]).trim(),
      lat: Number(depotRow["纬度"]),
      lon: Number(depotRow["经度"]),
    },
    constraints: { workStart: "09:00", workEnd: "17:30", maxWaitingMinutes: 90 },
  };
}

function knownFail(id, title, observed, evidence) {
  return { id, title, expectedBefore: "KNOWN_FAIL", observed, status: observed ? "KNOWN_FAIL" : "NOT_REPRODUCED", evidence };
}

async function main() {
  const { planning, optimizer, verifier } = loadV12();
  const results = [];

  const raw = simpleRaw();
  const original = planning.buildScenario({ raw, date: "2026-01-01", limit: "ALL", sourceBatchId: "BATCH-A" });
  const changedRaw = clone(raw);
  changedRaw.orders[0].lon += 10;
  changedRaw.orders[0].volume = 1000;
  const changed = planning.buildScenario({ raw: changedRaw, date: "2026-01-01", limit: "ALL", sourceBatchId: "BATCH-A" });
  results.push(knownFail("F0-01", "Business content mutation leaves inputHash unchanged", original.inputHash === changed.inputHash, { original: original.inputHash, changed: changed.inputHash }));

  const batchChanged = planning.buildScenario({ raw, date: "2026-01-01", limit: "ALL", sourceBatchId: "BATCH-B" });
  results.push(knownFail("F0-02", "Batch metadata changes inputHash", original.inputHash !== batchChanged.inputHash, { batchA: original.inputHash, batchB: batchChanged.inputHash }));

  const fakeRequest = optimizer.buildRequest({ scenario: original, goal: "distance", requestId: "F0-03" });
  fakeRequest.inputHash = "fnv1a-deadbeef";
  fakeRequest.inputFingerprint = fakeRequest.inputHash;
  fakeRequest.scenario.inputHash = fakeRequest.inputHash;
  fakeRequest.raw.orders[0].lon += 10;
  fakeRequest.raw.orders[0].volume = 1000;
  let fakeResponse;
  try {
    const response = await fetch(optimizerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fakeRequest) });
    const body = await response.json();
    fakeResponse = { httpStatus: response.status, ok: body.ok, responseInputHash: body.inputHash, engine: body.engine };
    if (evidenceDir) {
      fs.mkdirSync(path.join(evidenceDir, "requests"), { recursive: true });
      fs.mkdirSync(path.join(evidenceDir, "responses"), { recursive: true });
      fs.writeFileSync(path.join(evidenceDir, "requests", "F0-03-forged-hash-request.json"), `${JSON.stringify(fakeRequest, null, 2)}\n`);
      fs.writeFileSync(path.join(evidenceDir, "responses", "F0-03-forged-hash-response.json"), `${JSON.stringify({ httpStatus: response.status, body }, null, 2)}\n`);
    }
  } catch (error) {
    fakeResponse = { error: error.message };
  }
  results.push(knownFail("F0-03", "Server accepts forged inputHash", fakeResponse.httpStatus === 200 && fakeResponse.ok === true, fakeResponse));

  const baseOrders = [
    { id: "O1", lon: 120.1, lat: 30.1, volume: 1, weight: 1, twStart: "09:00", twEnd: "18:00", serviceMin: 5 },
    { id: "O2", lon: 120.2, lat: 30.2, volume: 1, weight: 1, twStart: "09:00", twEnd: "18:00", serviceMin: 5 },
  ];
  const baseVehicles = [{ vehicleId: "V1", maxVolume: 10, maxWeight: 10, start: "09:00", end: "18:00", fixedCost: 0, perKmCost: 1, perMinuteCost: 0, perStopCost: 0, emissionFactor: 0.1 }];
  const scenario = verifierScenario(baseOrders, baseVehicles);
  let coordinateTamper = recomputedPlan(verifier, scenario, [{ routeId: "R1", vehicleId: "V1", orders: ["O1", "O2"] }]);
  coordinateTamper.stopGeoJson.features[0].geometry.coordinates = [scenario.depot.lon, scenario.depot.lat];
  coordinateTamper = verifier.recomputePlan(coordinateTamper, scenario).plan;
  coordinateTamper.scenarioId = scenario.scenarioId;
  coordinateTamper.inputHash = scenario.inputHash;
  const coordinateVerification = verifier.verify(coordinateTamper, scenario);
  results.push(knownFail("F0-04", "Verifier trusts tampered stop coordinates", coordinateVerification.status === "PASS", { status: coordinateVerification.status, violations: coordinateVerification.violations, mismatches: coordinateVerification.metricMismatches }));

  const duplicateVehicle = recomputedPlan(verifier, scenario, [
    { routeId: "R1", vehicleId: "V1", orders: ["O1"] },
    { routeId: "R2", vehicleId: "V1", orders: ["O2"] },
  ]);
  const duplicateVehicleVerification = verifier.verify(duplicateVehicle, scenario);
  results.push(knownFail("F0-05", "One vehicle is accepted on two routes", duplicateVehicleVerification.status === "PASS", { status: duplicateVehicleVerification.status, violations: duplicateVehicleVerification.violations }));

  const waitScenario = verifierScenario(
    [{ id: "O1", lon: 120, lat: 30, volume: 1, weight: 1, twStart: "12:00", twEnd: "18:00", serviceMin: 5 }],
    baseVehicles,
  );
  const waitPlan = recomputedPlan(verifier, waitScenario, [{ routeId: "R1", vehicleId: "V1", orders: ["O1"] }]);
  const waitVerification = verifier.verify(waitPlan, waitScenario);
  results.push(knownFail("F0-06", "A 180 minute wait is accepted", waitVerification.status === "PASS", { status: waitVerification.status, stop: waitPlan.stopGeoJson.features[0].properties, maxWaitingMinutes: 90 }));

  const sample = workbookRaw();
  const rawPriorityDistribution = sample.orders.reduce((counts, order) => {
    counts[order.priority] = (counts[order.priority] || 0) + 1;
    return counts;
  }, {});
  const allScenario = planning.buildScenario({ raw: sample, date: "ALL", limit: "ALL", sourceBatchId: "F0-SAMPLE" });
  const mappedPriorityDistribution = allScenario.orders.reduce((counts, order) => {
    counts[String(order.priorityWeight)] = (counts[String(order.priorityWeight)] || 0) + 1;
    return counts;
  }, {});
  results.push(knownFail("F0-07", "Text priority values all map to weight 1", mappedPriorityDistribution["1"] === 520, { rawPriorityDistribution, mappedPriorityDistribution }));

  const dateCounts = {};
  [60, 120, 240, 520].forEach((limit) => {
    dateCounts[String(limit)] = new Set(sample.orders.slice(0, limit).map((order) => order.date)).size;
  });
  results.push(knownFail("F0-08", "ALL compresses multiple dates into one scenario and fleet", allScenario.planningDate === "ALL" && new Set(allScenario.orders.map((order) => order.date)).size === 31 && allScenario.vehicles.length === 7, {
    sampleDateCounts: dateCounts,
    scenarioPlanningDate: allScenario.planningDate,
    scenarioOrderCount: allScenario.orders.length,
    scenarioDistinctDates: new Set(allScenario.orders.map((order) => order.date)).size,
    scenarioVehicleCount: allScenario.vehicles.length,
  }));

  const manualPlan = recomputedPlan(verifier, scenario, [{ routeId: "R1", vehicleId: "V1", orders: ["O1", "O2"] }]);
  manualPlan.planId = "PLAN-F0";
  manualPlan.verification = { status: "PASS" };
  planning.state.scenario = scenario;
  planning.state.candidates = [manualPlan];
  planning.state.selectedPlanId = manualPlan.planId;
  planning.startManual();
  planning.manualAction("TOGGLE_ROUTE_LOCK", { routeId: "R1" });
  let undoError = null;
  try {
    planning.undoManual();
  } catch (error) {
    undoError = error.message;
  }
  results.push(knownFail("F0-09", "Route lock is not added to undo history", Boolean(undoError) && planning.state.manual.history.length === 0, { historyLength: planning.state.manual.history.length, actionsLength: planning.state.manual.actions.length, lockedRouteIds: planning.state.manual.lockedRouteIds, undoError }));

  const startScript = fs.readFileSync(path.join(root, "start_demo.sh"), "utf8");
  const requiresLsof = /require_command\s+lsof/.test(startScript);
  const hasFallback = /\b(ss|fuser|netstat|socket)\b/.test(startScript.replace(/port_pids[\s\S]*?}/, ""));
  results.push(knownFail("F0-10", "Start script hard-requires lsof", requiresLsof && !hasFallback, { requiresLsof, hasFallback }));

  const reproduced = results.filter((row) => row.status === "KNOWN_FAIL").length;
  const summary = {
    versionUnderTest: "v1.2",
    root,
    optimizerUrl,
    capturedAt: new Date().toISOString(),
    status: reproduced === results.length ? "PASS" : "FAIL",
    reproduced,
    total: results.length,
    results,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = summary.status === "PASS" ? 0 : 1;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
