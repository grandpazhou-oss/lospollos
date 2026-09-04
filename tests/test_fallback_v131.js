#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const clone = (value) => JSON.parse(JSON.stringify(value));
const raw = JSON.parse(fs.readFileSync(path.join(root, "assets", "demo", "stct-synthetic-demo.json"), "utf8"));
const flowFields = ["depot", "routes", "daySummaries", "routeGeoJson", "stopGeoJson", "missingStops", "splitRows"];
let appliedData = {
  id: "BEFORE-FALLBACK-APPLY",
  depot: { lat: 0, lon: 0 },
  routes: [],
  daySummaries: [],
  routeGeoJson: { type: "FeatureCollection", features: [] },
  stopGeoJson: { type: "FeatureCollection", features: [] },
  missingStops: [],
  splitRows: [],
};

function applyPlan(plan) {
  const missing = flowFields.filter((field) => !(field in plan));
  if (missing.length) throw new Error(`缺少字段：${missing.join(", ")}`);
  if (!Array.isArray(plan.routes)) throw new Error("routes 必须是数组");
  if (!plan.routeGeoJson?.features || !plan.stopGeoJson?.features) throw new Error("GeoJSON features 不完整");
  appliedData = clone(plan);
}

global.CustomEvent = class CustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};
global.window = {
  crypto: globalThis.crypto,
  location: { search: "?forceHeuristic=1&optPort=65534" },
  dispatchEvent() {},
  STCTUtils: {
    clone,
    csvSafe: (value) => `"${String(value ?? "").replace(/"/g, '""')}"`,
    escapeHTML: (value) => String(value ?? ""),
  },
  STCTCore: {
    getData: () => appliedData,
    setOptimizerPlan() {},
    applyPlan,
  },
};
global.document = {
  getElementById: () => null,
  createElement: () => ({ appendChild() {}, click() {}, remove() {} }),
  body: { appendChild() {} },
};

for (const file of ["config.js", "optimizer.js", "canonical.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file });
}
window.STCTCanonical.configure(JSON.parse(fs.readFileSync(path.join(root, "shared", "planning-contract-v13.json"), "utf8")));
for (const file of ["verifier.js", "planning-v12.js", "upload.js"]) {
  vm.runInThisContext(fs.readFileSync(path.join(root, file), "utf8"), { filename: file });
}

async function verifyPool(candidates, expectedInputHash) {
  assert(candidates.length > 0 && candidates.length <= 6);
  assert.strictEqual(window.STCTPlanning.state.sourceCandidates.length, 6);
  assert.strictEqual(Object.keys(window.STCTPlanning.state.goalLinks).length, 6);
  for (const source of window.STCTPlanning.state.sourceCandidates) {
    assert.strictEqual(source.engine, "Demo Heuristic");
    assert.strictEqual(source.solverStatus, "HEURISTIC_FEASIBLE");
    assert.notStrictEqual(source.solverStatus, "BEST_FOUND");
    assert.strictEqual(source.inputHash, expectedInputHash);
    assert(source.requestHash.startsWith("sha256:"));
    assert(source.planHash.startsWith("sha256:"));
    assert(source.routes.every((route) => route.vehicleId));
    assert(Array.isArray(source.splitRows));
    const verification = await window.STCTVerifier.verify(source, window.STCTPlanning.state.scenario);
    assert.strictEqual(verification.status, "PASS");
  }
  for (const candidate of candidates) {
    assert.strictEqual(candidate.verification.status, "PASS");
    assert(Array.isArray(candidate.splitRows));
  }
}

async function firstValidMove() {
  const routes = window.STCTPlanning.state.manual.plan.routes;
  for (const source of routes) {
    for (const orderId of source.orderIds) {
      for (const target of routes) {
        if (target.routeId === source.routeId) continue;
        try {
          const plan = await window.STCTPlanning.manualAction("MOVE_ORDER", {
            orderId,
            toRouteId: target.routeId,
            insertMode: "AUTO_MIN_DELTA",
          });
          return { plan, orderId, sourceRouteId: source.routeId, targetRouteId: target.routeId };
        } catch (_error) {
          // Rejected moves are transactional; continue until a feasible move is found.
        }
      }
    }
  }
  throw new Error("Synthetic dataset did not provide a valid manual move.");
}

async function main() {
  const checks = [];
  const check = (name, condition) => {
    assert(condition, name);
    checks.push(name);
  };

  check("synthetic_marker", raw.meta.synthetic === true && raw.meta.seed === 140031);
  check("three_dates", new Set(raw.orders.map((order) => order.date)).size === 3);
  check("three_priorities", ["high", "medium", "normal"].every((priority) => raw.orders.some((order) => order.priority === priority)));
  window.STCTPlanning.setRawData(raw, { batchId: "FALLBACK-SYNTHETIC" });

  const health = await window.STCTOptimizer.healthCheck();
  check("force_heuristic_health", health.forced === true && health.available === false && health.status === "forced_heuristic");
  const dayOneCandidates = await window.STCTOptimizer.generateScenarios({ raw, date: "2026-09-01", limit: "ALL" });
  const dayOneInputHash = window.STCTPlanning.state.scenario.inputHash;
  await verifyPool(dayOneCandidates, dayOneInputHash);
  check("candidate_pool_dedupes", dayOneCandidates.length <= window.STCTPlanning.state.sourceCandidates.length);

  window.STCTPlanning.selectScenario("balanced");
  const selected = window.STCTPlanning.currentCandidate();
  const beforeApply = clone(appliedData);
  const applied = await window.STCTPlanning.applySelected();
  check("apply_verified_flow_contract", applied.verification.status === "PASS" && appliedData.planHash === selected.planHash && flowFields.every((field) => field in appliedData));
  window.STCTPlanning.restore();
  check("restore_previous_data", appliedData.id === beforeApply.id);

  window.STCTPlanning.saveBaseline();
  const whatIfDayOne = await window.STCTPlanning.evaluateCapacityOptions();
  check("what_if_four_cases", whatIfDayOne.map((row) => row.id).join(",") === "current,plus-1,plus-2,shift-60");
  check("what_if_verifier_pass", whatIfDayOne.every((row) => row.verification.status === "PASS"));
  window.STCTPlanning.restoreBaseline();

  await window.STCTPlanning.startManual();
  const lockRoute = window.STCTPlanning.state.manual.plan.routes[0];
  const lockedOrder = lockRoute.orderIds[0];
  const otherRoute = window.STCTPlanning.state.manual.plan.routes.find((route) => route.routeId !== lockRoute.routeId);
  await window.STCTPlanning.manualAction("TOGGLE_ROUTE_LOCK", { routeId: lockRoute.routeId });
  await assert.rejects(
    () => window.STCTPlanning.manualAction("MOVE_ORDER", { orderId: lockedOrder, toRouteId: otherRoute.routeId, insertMode: "APPEND" }),
    /来源路线已锁定/,
  );
  check("locked_invalid_move_rejected", window.STCTPlanning.state.manual.lockedRouteIds.includes(lockRoute.routeId));
  await window.STCTPlanning.undoManual();
  check("lock_undo", window.STCTPlanning.state.manual.lockedRouteIds.length === 0);

  const beforeMoveHash = window.STCTPlanning.state.manual.plan.planHash;
  const moved = await firstValidMove();
  check("manual_move_pass", moved.plan.verification.status === "PASS" && moved.plan.planHash !== beforeMoveHash);
  await window.STCTPlanning.undoManual();
  check("move_undo_exact_hash", window.STCTPlanning.state.manual.plan.planHash === beforeMoveHash);

  const exportJson = window.STCTUpload.buildPlanningAuditJson();
  const exportCsv = window.STCTUpload.buildAuditCsv(window.STCTPlanning.currentCandidate());
  const exportJs = window.STCTUpload.buildCurrentJs(window.STCTPlanning.currentCandidate());
  check("export_json", JSON.parse(exportJson).scenario.inputHash === dayOneInputHash);
  check("export_csv", exportCsv.includes("recordType") && exportCsv.includes("Demo Heuristic"));
  check("export_js", exportJs.includes("window.FLOWMAP_DATA") && exportJs.includes(selected.planHash));

  window.STCTPlanning.stopManual();
  const dayTwoCandidates = await window.STCTOptimizer.generateScenarios({ raw, date: "2026-09-02", limit: "ALL" });
  await verifyPool(dayTwoCandidates, window.STCTPlanning.state.scenario.inputHash);
  window.STCTPlanning.selectScenario("balanced");
  window.STCTPlanning.saveBaseline();
  const pressureWhatIf = await window.STCTPlanning.evaluateCapacityOptions();
  const current = pressureWhatIf.find((row) => row.id === "current");
  const improved = pressureWhatIf.filter((row) => ["plus-1", "plus-2"].includes(row.id));
  check("capacity_pressure", current.metrics.unassigned > 0);
  const improvementFound = improved.some((row) => row.metrics.assigned > current.metrics.assigned && row.metrics.unassigned < current.metrics.unassigned);
  if (!improvementFound) throw new Error(`Synthetic What-if did not improve capacity pressure: ${JSON.stringify(pressureWhatIf.map((row) => ({ id: row.id, metrics: row.metrics, serviceFirst: row.serviceFirst.metrics, balancedSeed: row.balancedSeed.metrics, candidateCount: row.candidateCount })))}`);
  check("what_if_improves", improvementFound);

  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    mode: "fallback",
    engine: health.engine,
    sourceRequests: 6,
    dayOneCandidates: dayOneCandidates.length,
    dayTwoCandidates: dayTwoCandidates.length,
    dayOneInputHash,
    checks,
    capacityPressure: {
      current: current.metrics,
      alternatives: improved.map((row) => ({ id: row.id, metrics: row.metrics })),
    },
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
