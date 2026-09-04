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
  id: String(row["车辆ID"]), vehicleId: String(row["车辆ID"]), name: row["车辆名称"], type: row["车型"],
  maxWeight: row["最大载重"], maxVolume: row["最大容积"], start: row["可用开始"], end: row["可用结束"],
  availableDate: row["可用日期"], enabled: true,
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
  location: { search: `?optPort=${new URL(process.env.OPTIMIZER_URL || "http://127.0.0.1:19133").port}` },
  dispatchEvent() {},
  STCTUtils: { clone: (value) => JSON.parse(JSON.stringify(value)) },
  STCTCore: { setOptimizerPlan() {} },
};
global.document = { getElementById: () => null };

for (const file of ["config.js", "optimizer.js", "canonical.js"]) vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file });
window.STCTCanonical.configure(JSON.parse(fs.readFileSync(path.join(root, "shared", "planning-contract-v13.json"), "utf8")));
for (const file of ["verifier.js", "planning-v12.js"]) vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file });

async function main() {
  window.STCTPlanning.setRawData(raw, { batchId: "WHATIF-TEST" });
  window.STCTPlanning.state.scenarioSettings.timeLimitSeconds = 1;
  const baselineCandidates = await window.STCTOptimizer.generateScenarios({ raw, date: "2026-05-01", limit: 20 });
  assert(baselineCandidates.length > 0);
  window.STCTPlanning.selectScenario("balanced");
  const baseline = window.STCTPlanning.saveBaseline();
  const baselinePlanHash = baseline.plan.planHash;
  const baselineInputHash = baseline.scenario.inputHash;
  const templateId = baseline.scenario.vehicles[0].id;
  window.STCTPlanning.state.scenarioSettings.virtualVehicleTemplateId = templateId;

  const plusTwoScenario = await window.STCTPlanning.buildScenario({
    raw,
    date: "2026-05-01",
    limit: 20,
    settings: { ...baseline.settings, timeLimitSeconds: 1, virtualVehicleCount: 2, virtualVehicleTemplateId: templateId },
  });
  const virtualVehicles = plusTwoScenario.vehicles.filter((vehicle) => vehicle.isVirtual);
  assert.strictEqual(virtualVehicles.length, 2);
  assert.strictEqual(new Set(virtualVehicles.map((vehicle) => vehicle.id)).size, 2);
  assert(virtualVehicles.every((vehicle) => vehicle.sourceVehicleId === templateId));

  const results = await window.STCTPlanning.evaluateCapacityOptions();
  assert.deepStrictEqual(results.map((row) => row.id), ["current", "plus-1", "plus-2", "shift-60"]);
  assert.strictEqual(new Set(results.map((row) => row.inputHash)).size, 4);
  assert(results.every((row) => row.template.id === templateId));
  assert(results.every((row) => row.verification.status === "PASS"));
  assert(results.every((row) => row.serviceFirst.metrics.servicePriorityScore >= row.metrics.servicePriorityScore));
  assert(results.every((row) => row.serviceFirst.metrics.assigned >= row.metrics.assigned));
  assert(results.every((row) => row.serviceFirst.solverStatus !== "FALLBACK"));
  assert(results.every((row) => row.balancedSeed.solverStatus !== "FALLBACK"));
  assert(results.every((row) => row.baselinePlanHash === baselinePlanHash));
  assert(results.find((row) => row.id === "shift-60").inputHash !== baselineInputHash);

  const shiftScenario = await window.STCTPlanning.buildScenario({
    raw,
    date: "2026-05-01",
    limit: 20,
    settings: { ...baseline.settings, timeLimitSeconds: 1, shiftExtensionMinutes: 60, virtualVehicleTemplateId: templateId },
  });
  assert.strictEqual(Number(shiftScenario.constraintsSnapshot.shiftExtensionMinutes), 60);
  const restored = window.STCTPlanning.restoreBaseline();
  assert.strictEqual(restored.planHash, baselinePlanHash);
  assert.strictEqual(window.STCTPlanning.state.scenario.inputHash, baselineInputHash);

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    tests: 15,
    engine: window.STCTPlanning.state.engineHealth.engine,
    baseline: { inputHash: baselineInputHash, planHash: baselinePlanHash },
    template: results[0].template,
    virtualVehicleIds: virtualVehicles.map((vehicle) => vehicle.id),
    results: results.map((row) => ({
      id: row.id,
      inputHash: row.inputHash,
      baselinePlanHash: row.baselinePlanHash,
      serviceFirst: row.serviceFirst,
      balancedSeed: row.balancedSeed,
      selectedPlanHash: row.selectedPlanHash,
      metrics: row.metrics,
      delta: row.delta,
      verifier: row.verification.status,
      carriedBaseline: row.carriedBaseline,
    })),
    restoredPlanHash: restored.planHash,
  }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
