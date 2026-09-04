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
  STCTPlanning: { state: { candidates: [], phase: "builtin", engineHealth: {} }, setRawData() {}, markPreview() {} },
  STCTOptimizer: {
    assumptions: () => ({ roadDistanceFactor: 1.35, averageSpeedKmh: 35, defaultServiceMinutes: 5, carbonModel: { defaultVehicleFactor: 0.192 } }),
    planMetrics: (plan) => plan.metrics || {},
  },
};
global.document = { getElementById: () => null };
vm.runInThisContext(fs.readFileSync(path.join(root, "canonical.js"), "utf8"), { filename: "canonical.js" });
window.STCTCanonical.configure(JSON.parse(fs.readFileSync(path.join(root, "shared", "planning-contract-v13.json"), "utf8")));
vm.runInThisContext(fs.readFileSync(path.join(root, "verifier.js"), "utf8"), { filename: "verifier.js" });
vm.runInThisContext(fs.readFileSync(path.join(root, "planning-v12.js"), "utf8"), { filename: "planning-v12.js" });

async function main() {
  const baseUrl = process.env.OPTIMIZER_URL || "http://127.0.0.1:19127";
  const batch = await window.STCTPlanning.buildMultiDayBatch({ raw, limit: "60", sourceBatchId: "TEST-MULTIDAY-SOLVER", settings: { timeLimitSeconds: 1 } });
  const evidence = [];
  for (const child of batch.childScenarios) {
    const results = [];
    for (const goal of ["service", "balanced"]) {
      const request = await window.STCTOptimizer.buildRequest({ scenario: child.scenario, goal, requestId: `TEST-${child.scenario.planningDate}-${goal}`, requestSequence: results.length + 1 });
      const response = await fetch(`${baseUrl}/optimize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
      assert.strictEqual(response.status, 200, `${child.scenario.planningDate} ${goal}`);
      const envelope = await response.json();
      const verification = await window.STCTVerifier.verify(envelope.plan, child.scenario);
      results.push({ goal, status: verification.status, hardViolations: verification.hardViolations, planHash: envelope.planHash, metrics: envelope.plan.reportedMetrics });
    }
    evidence.push({ date: child.scenario.planningDate, orders: child.scenario.orders.length, vehicles: child.scenario.vehicles.length, inputHash: child.scenario.inputHash, results });
  }
  const failures = evidence.flatMap((day) => day.results.filter((result) => result.status !== "PASS").map((result) => ({ date: day.date, ...result })));
  assert.deepStrictEqual(failures, [], JSON.stringify(failures, null, 2));
  process.stdout.write(`${JSON.stringify({ status: "PASS", dates: evidence.length, requests: evidence.length * 2, evidence }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
