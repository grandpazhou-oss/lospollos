#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const clone = (value) => JSON.parse(JSON.stringify(value));
global.CustomEvent = class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
let appliedPlan = null;
global.window = {
  crypto: globalThis.crypto,
  dispatchEvent() {},
  STCTUtils: { clone },
  STCT_CONFIG: { maxOptimizerOrders: 500, maxSolveSeconds: 45, lowUtilizationThreshold: 35 },
  STCTCore: { setOptimizerPlan() {}, getData: () => ({}), applyPlan: (plan) => { appliedPlan = clone(plan); } },
  STCTPlanning: { state: { candidates: [], phase: "builtin", engineHealth: {} }, setRawData() {}, markPreview() {} },
  STCTOptimizer: {
    assumptions: () => ({ roadDistanceFactor: 1, averageSpeedKmh: 60, defaultServiceMinutes: 0, carbonModel: { defaultVehicleFactor: 0.2 } }),
    planMetrics: (plan) => plan.metrics || {}, healthCheck: async () => ({ available: true }),
  },
};
global.document = { getElementById: () => null };
vm.runInThisContext(fs.readFileSync(path.join(root, "canonical.js"), "utf8"), { filename: "canonical.js" });
const contract = JSON.parse(fs.readFileSync(path.join(root, "shared", "planning-contract-v13.json"), "utf8"));
window.STCTCanonical.configure(contract);
vm.runInThisContext(fs.readFileSync(path.join(root, "verifier.js"), "utf8"), { filename: "verifier.js" });
vm.runInThisContext(fs.readFileSync(path.join(root, "planning-v12.js"), "utf8"), { filename: "planning-v12.js" });

function sourceScenario() {
  const date = "2026-05-01";
  const order = (id, volume, lon) => ({ id, code: id, name: id, address: id, date, lon, lat: 0, count: 1, volume, weight: volume, serviceMin: 0, twStart: "09:00", twEnd: "18:00", priority: "normal", priorityWeight: 1, prioritySource: "mapped", orderType: "", requiredVehicleType: "" });
  const vehicle = (id) => ({ id, name: id, type: "van", availableDate: date, maxVolume: 10, maxWeight: 10, start: "09:00", end: "18:00", fixedCost: 100, perKmCost: 2, perMinuteCost: 0.5, perStopCost: 5, emissionFactor: 0.2, sourceVehicleId: id, isVirtual: false, enabled: true });
  return {
    planningMode: "SINGLE_DAY", planningDate: date,
    depot: { id: "D1", name: "Depot", address: "D", lon: 0, lat: 0 },
    orders: [order("O1", 4, 0.001), order("O2", 1, 0.002), order("O3", 7, 0.003), order("O4", 3, 0.004)],
    vehicles: [vehicle("V1"), vehicle("V2")],
    constraints: { singleTrip: true, maxWaitingMinutes: 90, workStart: "09:00", workEnd: "18:00", maxOrders: 500, maxSolveSeconds: 45, allowUnassigned: true, capacityScale: 1000, weightScale: 1000, maxStops: 500, maxRouteMinutes: 540, shiftExtensionMinutes: 0 },
    assumptions: { roadDistanceFactor: 1, averageSpeedKmh: 60, defaultServiceMin: 0, costModelVersion: "stct-cost-v1", emissionModelVersion: "stct-emission-v1", priorityMappingVersion: "priority-map-v1", missingVehicleDatePolicy: "blank-means-daily", missingTimeWindowPolicy: "reject-order", overnightPolicy: "end-before-start-means-next-day", distanceModel: "haversine-road-factor", roadMetersRounding: "half-up", travelMinutesRounding: "ceil", costMinuteBasis: "driving", defaultEmissionFactor: 0.2, lowUtilizationThreshold: 35, balancedWeightUsedVehicles: 20, balancedWeightDistance: 20, balancedWeightCost: 20, balancedWeightCarbon: 15, balancedWeightLatestEnd: 15, balancedWeightUtilization: 10 },
  };
}

async function initialPlan(scenario) {
  const authority = {
    routes: [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1", "O2"] }, { routeId: "R2", vehicleId: "V2", orderIds: ["O3"] }],
    unassignedOrderIds: ["O4"], blockedOrderIds: [], manualRevision: 0, parentPlanHash: "",
  };
  const planHash = (await window.STCTCanonical.planIdentity(scenario.inputHash, authority)).planHash;
  const source = { ...authority, planId: "PLAN-BASE", contractVersion: scenario.contractVersion, canonicalVersion: scenario.canonicalVersion, contentHash: scenario.contentHash, inputHash: scenario.inputHash, requestHash: `sha256:${"1".repeat(64)}`, planHash, serverHashVerified: true, engine: "OR-Tools", meta: { engine: "OR-Tools" } };
  const plan = window.STCTVerifier.recomputePlan(source, scenario).plan;
  plan.reportedMetrics = clone(plan.metrics);
  plan.planHash = planHash;
  const verification = await window.STCTVerifier.verify(plan, scenario);
  assert.strictEqual(verification.status, "PASS");
  plan.verification = { ...verification, recomputedPlan: undefined };
  return plan;
}

async function main() {
  const identity = await window.STCTCanonical.scenarioIdentity(sourceScenario());
  const scenario = { ...identity.scenario, scenarioId: "SCN-MANUAL", contentHash: identity.contentHash, inputHash: identity.inputHash, assumptionsSnapshot: { defaultServiceMinutes: 0 } };
  const base = await initialPlan(scenario);
  Object.assign(window.STCTPlanning.state, { scenario, candidates: [base], selectedPlanId: base.planId, planningMode: "SINGLE_DAY" });
  await window.STCTPlanning.startManual();
  const manual = window.STCTPlanning.state.manual;
  const checks = [];
  const check = (name, condition) => { assert(condition, name); checks.push(name); };

  const baseHash = manual.plan.planHash;
  await window.STCTPlanning.manualAction("TOGGLE_ROUTE_LOCK", { routeId: "R1" });
  check("lock_history_plus_one", manual.history.length === 1);
  check("lock_does_not_change_plan_hash", manual.plan.planHash === baseHash && manual.editorStateHash !== manual.baseEditorStateHash);
  await assert.rejects(() => window.STCTPlanning.manualAction("MOVE_ORDER", { orderId: "O1", toRouteId: "R2", insertMode: "APPEND" }), /来源路线已锁定/);
  check("locked_route_rejects_edit", manual.plan.planHash === baseHash);
  await window.STCTPlanning.undoManual();
  check("undo_lock_restores_unlocked", manual.lockedRouteIds.length === 0 && manual.plan.planHash === baseHash);

  const moved = await window.STCTPlanning.manualAction("MOVE_ORDER", { orderId: "O2", toRouteId: "R2", insertMode: "APPEND" });
  check("move_increments_revision", moved.manualRevision === 1 && moved.planId.endsWith("M001"));
  check("move_changes_plan_hash", moved.planHash !== baseHash);
  check("move_rebuilds_sequence", moved.routes.find((route) => route.routeId === "R2").orderIds.join(",") === "O3,O2");
  const movedHash = moved.planHash;
  await assert.rejects(() => window.STCTPlanning.manualAction("MOVE_ORDER", { orderId: "O1", toRouteId: "R2", insertMode: "APPEND" }), /ROUTE_VOLUME_CAPACITY_EXCEEDED/);
  check("invalid_move_is_transactional", manual.plan.planHash === movedHash && manual.revision === 1);
  await window.STCTPlanning.undoManual();
  check("undo_restores_exact_hash", manual.plan.planHash === baseHash && manual.revision === 0);

  const appended = await window.STCTPlanning.manualAction("ADD_UNASSIGNED", { orderId: "O4", toRouteId: "R2", insertMode: "APPEND" });
  check("append_position_is_explicit", appended.routes.find((route) => route.routeId === "R2").orderIds.join(",") === "O3,O4");
  check("append_seq_is_contiguous", appended.stopGeoJson.features.filter((feature) => feature.properties.routeId === "R2").map((feature) => feature.properties.seq).join(",") === "1,2");
  await window.STCTPlanning.undoManual();

  const after = await window.STCTPlanning.manualAction("ADD_UNASSIGNED", { orderId: "O4", toRouteId: "R2", insertMode: "AFTER", anchorOrderId: "O3" });
  check("after_position_is_audited", manual.actions.at(-1).insertPosition === 2 && after.routes.find((route) => route.routeId === "R2").orderIds[1] === "O4");
  await window.STCTPlanning.undoManual();
  await window.STCTPlanning.manualAction("ADD_UNASSIGNED", { orderId: "O4", toRouteId: "R2", insertMode: "AUTO_MIN_DELTA" });
  check("auto_min_delta_is_audited", Number.isFinite(manual.actions.at(-1).incrementalMeters));
  await window.STCTPlanning.undoManual();

  const reordered = await window.STCTPlanning.manualAction("REORDER_STOP", { orderId: "O2", direction: "up" });
  check("reorder_changes_order_and_hash", reordered.routes.find((route) => route.routeId === "R1").orderIds.join(",") === "O2,O1" && reordered.planHash !== baseHash);
  await window.STCTPlanning.undoManual();

  await window.STCTPlanning.manualAction("REMOVE_TO_UNASSIGNED", { orderId: "O1" });
  const emptied = await window.STCTPlanning.manualAction("REMOVE_TO_UNASSIGNED", { orderId: "O2" });
  check("empty_route_reduces_used_vehicles", emptied.metrics.usedVehicles === 1);
  check("manual_unassigned_reason", emptied.unassignedOrders.find((order) => order.id === "O2").reasonCode === "MANUALLY_UNASSIGNED");
  await window.STCTPlanning.undoManual();
  await window.STCTPlanning.undoManual();

  check("audit_has_before_after", manual.auditLog.filter((row) => row.actionType !== "UNDO").every((row) => row.beforePlanHash && row.afterPlanHash));
  check("undo_log_links_action", manual.auditLog.filter((row) => row.actionType === "UNDO").every((row) => row.revertedActionId));

  const tampered = clone(manual.plan);
  tampered.reportedMetrics.totalCost += 10;
  const tamperedResult = await window.STCTVerifier.verify(tampered, scenario);
  check("reported_metric_tamper_fails_without_identity_change", tampered.planHash === baseHash && tamperedResult.status === "FAIL" && tamperedResult.metricMismatchCount > 0);

  const applicable = await window.STCTPlanning.manualAction("REORDER_STOP", { orderId: "O2", direction: "up" });
  const applied = await window.STCTPlanning.applySelected();
  check("manual_apply_syncs_plan_hash", applied.planHash === applicable.planHash && appliedPlan.planHash === applicable.planHash);
  manual.revision += 1;
  await assert.rejects(() => window.STCTPlanning.applySelected(), /人工方案已过期/);
  check("stale_manual_draft_rejected", true);
  check("lineage_is_complete", applicable.basePlanHash === baseHash && applicable.parentPlanHash === baseHash && applicable.manualRevision === 1);

  process.stdout.write(`${JSON.stringify({ status: "PASS", tests: checks.length, checks, finalPlanHash: applicable.planHash, auditEvents: manual.auditLog.length }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
