#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const XLSX = require("../vendor/xlsx/xlsx.full.min.js");

const root = path.resolve(__dirname, "..");
const workbook = XLSX.read(fs.readFileSync(path.join(root, "templates", "laiyifen-202605-rawdata.xlsx")), { type: "buffer" });
const rows = (name) => XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "" });
const orders = rows("Orders").map((row) => ({
  id: String(row["订单号"]), code: String(row["客户代码"]), name: row["配送点名称"], address: row["地址"],
  date: String(row["配送日"]), lat: row["纬度"], lon: row["经度"], count: row["件数"], weight: row["重量"], volume: row["体积"],
  twStart: row["时间窗开始"], twEnd: row["时间窗结束"], serviceMin: row["服务时间"], priority: row["优先级"], orderType: row["订单类型"],
}));
const vehicles = rows("Vehicles").map((row) => ({
  id: String(row["车辆ID"]), vehicleId: String(row["车辆ID"]), name: row["车辆名称"], type: row["车型"], maxWeight: row["最大载重"], maxVolume: row["最大容积"],
  start: row["可用开始"], end: row["可用结束"], availableDate: row["可用日期"], enabled: true,
}));
const depotRow = rows("Depots")[0];
const raw = {
  orders,
  vehicles,
  depot: { id: String(depotRow["仓库ID"]), name: depotRow["仓库名称"], address: depotRow["地址"], lat: depotRow["纬度"], lon: depotRow["经度"] },
  constraints: { workStart: "09:00", workEnd: "17:30", maxWaitingMinutes: 90, maxStops: 500, maxRouteMinutes: 1440 },
};

global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
global.window = {
  crypto: globalThis.crypto,
  dispatchEvent() {},
  STCTUtils: { clone: (value) => JSON.parse(JSON.stringify(value)) },
  STCT_CONFIG: { maxOptimizerOrders: 500, maxSolveSeconds: 45, lowUtilizationThreshold: 35 },
  STCTPlanning: {
    state: { candidates: [], phase: "builtin", engineHealth: {} },
    setRawData() {},
    markPreview() {},
  },
  STCTOptimizer: {
    assumptions: () => ({ roadDistanceFactor: 1.35, averageSpeedKmh: 35, defaultServiceMinutes: 5, carbonModel: { defaultVehicleFactor: 0.192 } }),
    planMetrics: (plan) => plan.metrics || {},
  },
  STCTVerifier: {
    fleetAdequacy: (scenario) => ({ totalOrders: scenario.orders.length, availableVehicles: scenario.vehicles.length, note: "test" }),
  },
};
global.document = { getElementById: () => null };
vm.runInThisContext(fs.readFileSync(path.join(root, "canonical.js"), "utf8"), { filename: "canonical.js" });
window.STCTCanonical.configure(JSON.parse(fs.readFileSync(path.join(root, "shared", "planning-contract-v13.json"), "utf8")));
vm.runInThisContext(fs.readFileSync(path.join(root, "planning-v12.js"), "utf8"), { filename: "planning-v12.js" });

async function main() {
  const mixed = JSON.parse(fs.readFileSync(path.join(root, "shared", "canonical-hash-fixtures.json"), "utf8")).cases[0].scenario;
  mixed.orders[1].date = "2026-05-02";
  await assert.rejects(() => window.STCTCanonical.scenarioIdentity(mixed), (error) => error.code === "MULTIPLE_ORDER_DATES_IN_SINGLE_DAY_SCENARIO");
  const expected = { "60": 4, "120": 8, "240": 15, ALL: 31 };
  const evidence = [];
  for (const [limit, dateCount] of Object.entries(expected)) {
    const buildStarted = performance.now();
    const batch = await window.STCTPlanning.buildMultiDayBatch({ raw, limit, sourceBatchId: `TEST-${limit}` });
    const aggregateBuildMs = Number((performance.now() - buildStarted).toFixed(3));
    assert.strictEqual(batch.dateCount, dateCount, limit);
    assert.strictEqual(batch.totalOrders, limit === "ALL" ? 520 : Number(limit));
    assert(batch.aggregateHash.startsWith("sha256:"));
    assert(batch.batchContentHash.startsWith("sha256:"));
    assert.strictEqual(batch.childInputHashes.length, dateCount);
    assert.strictEqual(new Set(batch.childInputHashes).size, dateCount);
    assert(batch.childScenarios.every((child) => new Set(child.scenario.orders.map((order) => order.date)).size === 1));
    assert(batch.childScenarios.every((child) => child.scenario.orders.every((order) => order.date === child.scenario.planningDate)));
    assert(batch.childScenarios.every((child) => child.scenario.vehicles.length === 7));
    assert.strictEqual(batch.conservation.input, batch.totalOrders);
    assert.strictEqual(batch.conservation.pending, batch.totalOrders);
    evidence.push({
      limit,
      dateCount,
      totalOrders: batch.totalOrders,
      parentBatchScenarioId: batch.parentBatchScenarioId,
      aggregateHash: batch.aggregateHash,
      aggregateBuildMs,
      dates: batch.childScenarios.map((child) => ({ date: child.scenario.planningDate, orders: child.scenario.orders.length, vehicles: child.scenario.vehicles.length, inputHash: child.scenario.inputHash })),
    });
  }
  const availabilityRaw = {
    ...raw,
    orders: [orders[0], { ...orders[20], date: "2026-05-02" }],
    vehicles: [
      { ...vehicles[0], id: "DAILY", vehicleId: "DAILY", availableDate: "" },
      { ...vehicles[1], id: "DAY-ONE", vehicleId: "DAY-ONE", availableDate: "2026-05-01" },
      { ...vehicles[2], id: "DAY-TWO", vehicleId: "DAY-TWO", availableDate: "2026-05-02" },
    ],
  };
  const availability = await window.STCTPlanning.buildMultiDayBatch({ raw: availabilityRaw, limit: "ALL" });
  assert.deepStrictEqual(availability.childScenarios[0].scenario.vehicles.map((vehicle) => vehicle.id), ["DAILY", "DAY-ONE"]);
  assert.deepStrictEqual(availability.childScenarios[1].scenario.vehicles.map((vehicle) => vehicle.id), ["DAILY", "DAY-TWO"]);

  const aggregateBatch = await window.STCTPlanning.buildMultiDayBatch({ raw, limit: "60" });
  aggregateBatch.childScenarios.forEach((child, index) => {
    const input = child.scenario.orders.length;
    const assigned = Math.max(0, input - index);
    child.status = "PASS";
    child.selectedPlan = { metrics: { assigned, unassigned: input - assigned, blocked: 0, usedVehicles: index + 1, estimatedRoadKm: 10 + index, totalCost: 100 + index, totalCO2: 5 + index } };
  });
  const aggregate = window.STCTPlanning.aggregateMultiDay(aggregateBatch);
  assert.strictEqual(aggregateBatch.conservation.balanced, true);
  assert.strictEqual(aggregate.peakUsedVehicles, 4);
  assert.strictEqual(aggregate.estimatedRoadKm, 46);
  assert.strictEqual(aggregate.totalCost, 406);
  assert.strictEqual(aggregate.totalCO2, 26);
  assert.strictEqual(aggregate.serviceRate, aggregate.assigned / aggregateBatch.totalOrders * 100);
  const priority = orders.reduce((result, order) => { result[order.priority] = (result[order.priority] || 0) + 1; return result; }, {});
  assert.deepStrictEqual(priority, { high: 50, normal: 368, medium: 102 });
  process.stdout.write(`${JSON.stringify({ status: "PASS", workbook: "templates/laiyifen-202605-rawdata.xlsx", priority, evidence }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
