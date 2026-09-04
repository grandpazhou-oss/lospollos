"use strict";

const assert = require("assert");
const Timeline = require("../timeline-v14.js");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

function check(name, condition) {
  assert.ok(condition, name);
  process.stdout.write(`PASS ${name}\n`);
}

function makePlanning(plan) {
  const state = {
    manual: null,
    current: clone(plan),
    history: [],
  };
  return {
    state,
    currentCandidate: () => state.manual?.plan || state.current,
    async startManual() {
      state.manual = { active: true, plan: clone(state.current), lockedRouteIds: [] };
      return state.manual.plan;
    },
    async manualAction(type, payload) {
      const before = clone(state.manual.plan);
      state.history.push({ plan: before, lockedRouteIds: clone(state.manual.lockedRouteIds) });
      if (payload.orderId === "INVALID") {
        state.history.pop();
        const error = new Error("invalid move");
        error.code = "TIME_WINDOW_VIOLATION";
        throw error;
      }
      if (type === "TOGGLE_ROUTE_LOCK") {
        const locks = state.manual.lockedRouteIds;
        state.manual.lockedRouteIds = locks.includes(payload.routeId) ? locks.filter((id) => id !== payload.routeId) : [...locks, payload.routeId];
        return state.manual.plan;
      }
      state.manual.plan.planHash = `${before.planHash}:${type}:${state.history.length}`;
      state.manual.plan.manualRevision = (before.manualRevision || 0) + 1;
      state.manual.plan.verification.computedPlanHash = state.manual.plan.planHash;
      return state.manual.plan;
    },
    async undoManual() {
      if (!state.history.length) throw new Error("nothing to undo");
      const previous = state.history.pop();
      state.manual.plan = previous.plan;
      state.manual.lockedRouteIds = previous.lockedRouteIds;
      return state.manual.plan;
    },
    async resetManual() {
      state.manual.plan = clone(state.current);
      state.history = [];
      return state.manual.plan;
    },
  };
}

async function main() {
  const { scenario, plan } = buildFixture();
  const timeline = Timeline.buildTimeline(plan, scenario, { replayCursorMinute: 540 });
  check("01_lane_count_equals_used_routes", timeline.lanes.length === plan.verification.recomputedMetrics.usedVehicles);
  const firstStop = plan.stopGeoJson.features.find((feature) => feature.properties.orderId === "ORDER-001").properties;
  const serviceBlock = timeline.lanes.flatMap((lane) => lane.blocks).find((block) => block.type === Timeline.BLOCK_TYPES.SERVICE && block.orderId === "ORDER-001");
  check("02_blocks_match_verifier_schedule", serviceBlock.startMinute === firstStop.serviceStartMinutes && serviceBlock.endMinute === firstStop.departureMinutes);

  const waitScenario = clone(scenario);
  waitScenario.orders.find((order) => order.id === "ORDER-002").twStart = "09:48";
  const waitTimeline = Timeline.buildTimeline(plan, waitScenario);
  const waitBlock = waitTimeline.lanes.flatMap((lane) => lane.blocks).find((block) => block.type === Timeline.BLOCK_TYPES.WAITING && block.orderId === "ORDER-002");
  check("03_wait_90_visible", waitBlock?.minutes === 90);
  check("04_lunch_break_visible", timeline.lanes.every((lane) => lane.blocks.some((block) => block.type === Timeline.BLOCK_TYPES.LUNCH_BREAK)));
  check("05_shift_end_visible", timeline.lanes.every((lane) => Number.isFinite(lane.shiftEndMinute) && lane.shiftEndMinute > lane.shiftStartMinute));

  const controller = Timeline.createTimelineController(plan, scenario, { replayCursorMinute: 520 });
  controller.selectRoute("R-2");
  check("06_route_selection", controller.state.selectedRouteId === "R-2" && !controller.state.selectedOrderId);
  controller.selectStop("ORDER-002");
  check("07_stop_selection", controller.state.selectedOrderId === "ORDER-002" && controller.state.selectedRouteId === "R-2");
  controller.setReplayCursor(615);
  check("08_replay_cursor_sync", controller.snapshot().timeline.replayCursorMinute === 615);

  const profile = Timeline.capacityProfile(plan, scenario, "R-1");
  check("09_capacity_profile_conservation", profile.volumeConserved && profile.weightConserved && profile.points.at(-1).remainingVolume === 0 && profile.notice === Timeline.CAPACITY_NOTICE);
  const priorities = Timeline.priorityLens(plan, scenario);
  check("10_priority_lens", priorities.length === scenario.orders.length && priorities.some((row) => row.priority === "high" && row.assigned));
  const diagnosticPlan = clone(plan);
  diagnosticPlan.unassignedOrders = [{ id: "ORDER-X", reasonCode: "CAPACITY_PRESSURE", confidence: "probable", evidence: { routeCount: 2 } }];
  const diagnostics = Timeline.diagnosticLens(diagnosticPlan, scenario);
  check("11_diagnostic_confidence", diagnostics.scenarioPressure.confidence === "deterministic" && diagnostics.orders[0].confidence === "probable");

  const planning = makePlanning(plan);
  const lock = await Timeline.manualTransaction(planning, "TOGGLE_ROUTE_LOCK", { routeId: "R-1" });
  check("12_lock_route", lock.status === "COMMIT" && planning.state.manual.lockedRouteIds.includes("R-1") && lock.beforePlanHash === lock.afterPlanHash);
  const unlockUndo = await Timeline.manualTransaction(planning, "UNDO");
  check("13_lock_undo", unlockUndo.status === "COMMIT" && !planning.state.manual.lockedRouteIds.includes("R-1"));

  const reorder = await Timeline.manualTransaction(planning, "REORDER_STOP", { orderId: "ORDER-001", direction: "down" });
  check("14_reorder_success", reorder.status === "COMMIT" && reorder.afterPlanHash !== reorder.beforePlanHash);
  const move = Timeline.buildMoveCommand({ orderId: "ORDER-001", targetRouteId: "R-2", insertMode: "APPEND" });
  const moved = await Timeline.manualTransaction(planning, move.actionType, move.payload);
  check("15_cross_route_move_success", moved.status === "COMMIT" && move.payload.toRouteId === "R-2");
  const beforeInvalid = planning.state.manual.plan.planHash;
  const invalid = await Timeline.manualTransaction(planning, "MOVE_ORDER", { orderId: "INVALID", toRouteId: "R-2", insertMode: "APPEND" });
  check("16_invalid_move_rolls_back", invalid.status === "ROLLBACK" && invalid.verifierCode === "TIME_WINDOW_VIOLATION" && invalid.afterPlanHash === beforeInvalid);

  const append = Timeline.buildMoveCommand({ orderId: "ORDER-003", targetRouteId: "R-2", insertMode: "APPEND" });
  check("17_explicit_insert_end", append.payload.insertMode === "APPEND" && !append.payload.anchorOrderId);
  const after = Timeline.buildMoveCommand({ orderId: "ORDER-003", targetRouteId: "R-2", insertMode: "AFTER", anchorOrderId: "ORDER-002" });
  check("18_explicit_insert_after", after.payload.insertMode === "AFTER" && after.payload.anchorOrderId === "ORDER-002");
  const minimum = Timeline.buildMoveCommand({ orderId: "ORDER-003", targetRouteId: "R-2", insertMode: "AUTO_MIN_DELTA" });
  check("19_minimum_incremental_insert", minimum.payload.insertMode === "AUTO_MIN_DELTA");
  const add = Timeline.buildUnassignedCommand({ orderId: "ORDER-099", targetRouteId: "R-2", insertMode: "BEFORE", anchorOrderId: "ORDER-002" });
  check("20_unassigned_to_route", add.actionType === "ADD_UNASSIGNED" && add.payload.insertMode === "BEFORE");
  const mobileApplied = await Timeline.manualTransaction(planning, add.actionType, add.payload);
  check("21_mobile_action_sheet_path", mobileApplied.status === "COMMIT" && add.payload.source === "timeline-mobile");

  const validHash = planning.state.manual.plan.planHash;
  const invalidAgain = await Timeline.manualTransaction(planning, "MOVE_ORDER", { orderId: "INVALID", toRouteId: "R-1", insertMode: "APPEND" });
  check("22_plan_hash_only_changes_after_valid_edit", invalidAgain.afterPlanHash === validHash);
  const visualHash = controller.state.planHash;
  controller.setLens("capacity");
  controller.setLens("priority");
  controller.setLens("diagnostic");
  check("23_visual_lens_does_not_modify_hash", controller.state.planHash === visualHash && plan.planHash === visualHash);

  const noWebgl = Timeline.buildTimeline(plan, scenario, { webglAvailable: false, replayCursorMinute: 540 });
  check("24_no_webgl_timeline_same_facts", JSON.stringify(noWebgl.lanes) === JSON.stringify(timeline.lanes) && !noWebgl.webglAvailable);
  const reduced = Timeline.createTimelineController(plan, scenario, { reducedMotion: true }).snapshot();
  check("25_reduced_motion_no_transition_dependency", reduced.transitionMs === 0 && reduced.timeline.lanes.length === timeline.lanes.length);

  let mapCalls = 0;
  let timelineCalls = 0;
  let bridge;
  bridge = Timeline.createSelectionBridge({
    onMapFocus(selection) { mapCalls += 1; bridge.fromMap(selection); },
    onTimelineFocus() { timelineCalls += 1; },
  });
  bridge.fromTimeline({ orderId: "ORDER-001" });
  check("26_map_sync_has_no_event_loop", mapCalls === 1 && timelineCalls === 0);

  const xray = Timeline.xrayGeoJson(plan, scenario, "capacity");
  check("27_xray_overlay_uses_direct_labels", xray.routes.features.every((feature) => feature.properties.xrayLens === "capacity" && ["NORMAL", "MEDIUM", "HIGH"].includes(feature.properties.pressure)));

  assert.throws(() => Timeline.buildMoveCommand({ orderId: "ORDER-001", targetRouteId: "R-2", insertMode: "AFTER" }), /anchorOrderId/);
  process.stdout.write("PASS 28_ambiguous_insert_rejected\n");

  const large = buildFixture({ orderCount: 240, routeCount: 7, planSuffix: "TIMELINE-240" });
  const largeController = Timeline.createTimelineController(large.plan, large.scenario);
  largeController.selectStop("ORDER-240");
  const largeSnapshot = largeController.snapshot();
  check("29_240_stop_static_timeline_selection", largeSnapshot.timeline.lanes.length === 7
    && largeSnapshot.timeline.lanes.flatMap((lane) => lane.blocks).filter((block) => block.type === Timeline.BLOCK_TYPES.SERVICE).length === 240
    && largeSnapshot.selectedOrderId === "ORDER-240");

  console.log("PASS timeline and constraint x-ray v1.4");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
