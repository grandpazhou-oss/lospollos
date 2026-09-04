"use strict";

const assert = require("assert");
const Arena = require("../scenario-arena-v14.js");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

function check(name, condition) {
  assert.ok(condition, name);
  process.stdout.write(`PASS ${name}\n`);
}

function seal(plan, suffix) {
  plan.planId = `PLAN-${suffix}`;
  plan.planHash = `sha256:plan-${suffix}`;
  plan.requestHash = `sha256:request-${suffix}`;
  plan.verification = {
    ...plan.verification,
    status: "PASS",
    computedPlanHash: plan.planHash,
    recomputedMetrics: clone(plan.metrics),
    hardViolations: [],
    metricMismatches: [],
  };
  return plan;
}

function setRouteOrders(plan, routeId, orderIds) {
  const route = plan.routes.find((candidate) => candidate.routeId === routeId);
  route.orderIds = [...orderIds];
  plan.stopGeoJson.features.forEach((feature) => {
    const orderId = feature.properties.orderId;
    const index = orderIds.indexOf(orderId);
    if (index >= 0) {
      feature.properties.routeId = routeId;
      feature.properties.vehicleId = route.vehicleId;
      feature.properties.seq = index + 1;
    }
  });
}

function fakeMap() {
  const handlers = new Set();
  return {
    jumps: [],
    on(name, fn) { if (name === "move") handlers.add(fn); },
    off(name, fn) { if (name === "move") handlers.delete(fn); },
    emit() { [...handlers].forEach((fn) => fn()); },
    getCenter() { return { lng: 121.36, lat: 31.18 }; },
    getZoom() { return 11; },
    getBearing() { return 0; },
    getPitch() { return 0; },
    jumpTo(value) { this.jumps.push(value); },
    listenerCount() { return handlers.size; },
  };
}

function main() {
  const base = buildFixture();
  const planA = base.plan;
  const scenario = base.scenario;

  const planB = clone(planA);
  const r1 = [...planB.routes[0].orderIds];
  const r2 = [...planB.routes[1].orderIds];
  const moved = r1.pop();
  setRouteOrders(planB, "R-1", r1.reverse());
  setRouteOrders(planB, "R-2", [...r2, moved]);
  planB.metrics.usedVehicles = 2;
  planB.metrics.estimatedRoadKm -= 8;
  planB.metrics.totalCost -= 40;
  planB.metrics.totalCO2 -= 1.4;
  planB.metrics.latestEndMinutes -= 15;
  planB.metrics.utilizationScore += 8;
  seal(planB, "B");

  const comparison = Arena.buildComparison(planA, scenario, planB, scenario);
  check("01_same_input_comparable", comparison.sameInputHash && comparison.status === "COMPARABLE" && comparison.improvementClaimAllowed);
  const other = buildFixture({ inputSuffix: "OTHER", planSuffix: "OTHER" });
  const changedScenario = Arena.buildComparison(planA, scenario, other.plan, other.scenario);
  check("02_different_input_scenario_changed", !changedScenario.sameInputHash && changedScenario.status === "SCENARIO_CHANGED" && !changedScenario.improvementClaimAllowed);

  const invalid = clone(planB);
  invalid.verification.status = "FAIL";
  assert.throws(() => Arena.buildComparison(planA, scenario, invalid, scenario), /cannot enter Arena/);
  process.stdout.write("PASS 03_invalid_plan_blocked\n");

  const distance = comparison.metrics.find((metric) => metric.id === "estimatedRoadKm");
  check("04_metrics_from_verifier", distance.planB === planB.verification.recomputedMetrics.estimatedRoadKm && distance.percent !== null);
  check("05_reassigned_order_detected", comparison.changes.some((change) => change.type === Arena.CHANGE_TYPES.REASSIGNED_ROUTE));
  check("06_sequence_change_detected", comparison.changes.some((change) => change.type === Arena.CHANGE_TYPES.SEQUENCE_CHANGED));

  const withUnassigned = clone(planA);
  const unassignedId = withUnassigned.routes[1].orderIds.pop();
  withUnassigned.unassignedOrderIds = [unassignedId];
  seal(withUnassigned, "UNASSIGNED");
  const newly = Arena.buildComparison(withUnassigned, scenario, planA, scenario);
  const became = Arena.buildComparison(planA, scenario, withUnassigned, scenario);
  check("07_newly_assigned_detected", newly.changes.some((change) => change.orderId === unassignedId && change.type === Arena.CHANGE_TYPES.NEWLY_ASSIGNED));
  check("08_became_unassigned_detected", became.changes.some((change) => change.orderId === unassignedId && change.type === Arena.CHANGE_TYPES.BECAME_UNASSIGNED));

  const oneRoute = clone(planA);
  const allIds = oneRoute.routes.flatMap((route) => route.orderIds);
  setRouteOrders(oneRoute, "R-1", allIds);
  oneRoute.routes = [oneRoute.routes.find((route) => route.routeId === "R-1")];
  oneRoute.metrics.usedVehicles = 1;
  seal(oneRoute, "ONE-ROUTE");
  const routeChange = Arena.buildComparison(planA, scenario, oneRoute, scenario);
  check("09_route_removed_detected", routeChange.changes.some((change) => change.type === Arena.CHANGE_TYPES.ROUTE_REMOVED && change.routeId === "R-2"));

  const addedRoute = clone(oneRoute);
  addedRoute.routes.push({ ...clone(planA.routes[1]), routeId: "R-3", orderIds: [] });
  seal(addedRoute, "ROUTE-ADDED");
  check("10_route_added_detected", Arena.changeSet(oneRoute, addedRoute).some((change) => change.type === Arena.CHANGE_TYPES.ROUTE_ADDED && change.routeId === "R-3"));

  const changedVehicle = clone(planA);
  changedVehicle.routes[0].vehicleId = "VEH-4";
  seal(changedVehicle, "VEHICLE");
  check("11_vehicle_changed_detected", Arena.changeSet(planA, changedVehicle).some((change) => change.type === Arena.CHANGE_TYPES.VEHICLE_CHANGED));

  const same = Arena.buildComparison(planA, scenario, clone(planA), scenario);
  check("12_no_false_delta", same.metrics.every((metric) => metric.delta === 0) && same.changes.filter((change) => change.orderId).every((change) => change.type === Arena.CHANGE_TYPES.UNCHANGED_ASSIGNMENT));

  const overlay = Arena.overlayFeatures(planA, planB);
  check("13_overlay_features_tagged", overlay.features.length === planA.routeGeoJson.features.length + planB.routeGeoJson.features.length
    && overlay.features.some((feature) => feature.properties.arenaStyle === "ghost")
    && overlay.features.some((feature) => feature.properties.arenaStyle === "solid"));

  const leftMap = fakeMap();
  const rightMap = fakeMap();
  const sync = Arena.createCameraSynchronizer(leftMap, rightMap);
  leftMap.emit();
  check("14_split_camera_sync", rightMap.jumps.length === 1 && leftMap.listenerCount() === 1 && rightMap.listenerCount() === 1);
  sync.destroy();
  check("15_split_destroy_cleans_listeners", sync.destroyed && leftMap.listenerCount() === 0 && rightMap.listenerCount() === 0);

  const controller = Arena.createArenaController({ plans: [planA, planB], scenarios: [scenario], leftPlanHash: planA.planHash, rightPlanHash: planB.planHash });
  controller.setMobileSide("B");
  check("16_mobile_ab_switch", controller.state.mobileSide === "B");
  const planHashBefore = controller.state.rightPlanHash;
  const reducedController = Arena.createArenaController({ plans: [planA, planB], scenarios: [scenario], reducedMotion: true, webglAvailable: false, lowPower: true });
  reducedController.setVisualMode("split");
  const reducedState = reducedController.snapshot();
  check("17_reduced_and_low_power_fallback", reducedState.transitionMs === 0 && reducedState.visualMode === "overlay");

  const table = Arena.noWebglTable(comparison);
  check("18_no_webgl_table", table.length === Arena.METRICS.length && table.every((row) => row.semantic === "Verified metric comparison"));
  check("19_selection_does_not_change_plan_hash", controller.state.rightPlanHash === planHashBefore && planB.planHash === "sha256:plan-B");

  const manual = clone(planB);
  manual.meta.manualAdjustmentAudit = [{ actionType: "MOVE_ORDER", orderId: moved, verifierStatus: "PASS" }];
  seal(manual, "MANUAL");
  const manualComparison = Arena.buildComparison(planA, scenario, manual, scenario);
  check("20_manual_audit_evidence", manualComparison.manualAuditEvidence.length === 1 && manualComparison.whyChanged.some((entry) => entry.constraintEvidence.manualAudit.length));

  check("21_what_if_scenario_delta", changedScenario.scenarioDelta.inputHashA !== changedScenario.scenarioDelta.inputHashB
    && changedScenario.metrics.every((metric) => metric.percent === null && metric.semantic === "SCENARIO_DELTA"));

  const exported = Arena.exportComparison(comparison);
  const parsed = JSON.parse(exported);
  check("22_export_comparison_json", parsed.version === "stct-arena-v1.4" && parsed.planA.planHash === planA.planHash && parsed.planB.planHash === planB.planHash);

  const evidence = comparison.whyChanged.find((entry) => entry.observedChange.type === Arena.CHANGE_TYPES.REASSIGNED_ROUTE);
  check("23_why_changed_is_evidence_bounded", evidence && evidence.notProven.includes("not proven") && evidence.constraintEvidence.routeA && evidence.constraintEvidence.routeB);

  const changedTable = Arena.noWebglTable(changedScenario);
  check("24_changed_scenario_has_no_improvement_percent", changedTable.every((row) => row.percent === null && row.semantic === "Scenario changed"));

  console.log("PASS scenario arena v1.4 deterministic comparison");
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
