"use strict";

const assert = require("assert");
const Replay = require("../replay-v14.js");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

function check(name, condition) {
  assert.ok(condition, name);
  process.stdout.write(`PASS ${name}\n`);
}

function main() {
  const { scenario, plan } = buildFixture();
  const model = Replay.buildReplayModel(plan, scenario);
  const route1 = model.schedules.find((route) => route.routeId === "R-1");
  const route2 = model.schedules.find((route) => route.routeId === "R-2");
  const first1 = route1.stops[0];
  const first2 = route2.stops[0];

  check("01_before_start_not_started", Replay.vehicleStateAt(route1, route1.startMinute - 1).status === Replay.VEHICLE_STATUS.NOT_STARTED);
  const traveling = Replay.vehicleStateAt(route1, first1.travelStartMinute + 5);
  check("02_travel_marker_inside_segment", traveling.status === Replay.VEHICLE_STATUS.TRAVELING
    && traveling.coordinate[0] !== first1.fromCoordinate[0]
    && traveling.coordinate[0] !== first1.coordinate[0]);
  check("03_arrival_wait_state", Replay.vehicleStateAt(route2, first2.rawArrivalMinute + 1).status === Replay.VEHICLE_STATUS.WAITING_FOR_WINDOW);
  check("04_service_state", Replay.vehicleStateAt(route2, first2.serviceStartMinute + 1).status === Replay.VEHICLE_STATUS.SERVICING);
  check("05_route_completed", Replay.vehicleStateAt(route1, route1.returnMinute + 1).status === Replay.VEHICLE_STATUS.COMPLETED);

  const controller = Replay.createReplayController(plan, scenario, { speed: 4 });
  const targetMinute = first1.serviceStartMinute + 2;
  const forward = controller.setTime(targetMinute).frame;
  controller.setTime(route1.returnMinute);
  const backward = controller.setTime(targetMinute).frame;
  check("06_scrub_reversible", JSON.stringify(forward) === JSON.stringify(backward));
  controller.restart();
  check("07_restart_initial", controller.state.status === "idle" && controller.state.currentMinute === controller.state.startMinute);

  controller.setTime(controller.state.startMinute);
  controller.setSpeed(1);
  controller.play();
  controller.tick(5000);
  const atOne = controller.state.currentMinute;
  controller.restart();
  controller.setSpeed(60);
  controller.play();
  controller.tick(5000 / 60);
  check("08_speed_preserves_logical_result", Math.abs(controller.state.currentMinute - atOne) < 1e-9);
  controller.handleVisibility(true);
  check("09_hidden_tab_pauses", controller.state.status === "paused" && controller.state.pausedByVisibility);
  controller.handleVisibility(false);
  check("10_visible_does_not_auto_resume", controller.state.status === "paused" && !controller.state.pausedByVisibility);

  controller.selectVehicle("VEH-2");
  controller.setFollow(true);
  check("11_follow_selected_vehicle", controller.state.selectedVehicleId === "VEH-2" && controller.state.followVehicle);
  controller.escapeFollow();
  check("12_escape_exits_follow", controller.state.followVehicle === false);

  const planHashBefore = plan.planHash;
  controller.setTime(499);
  controller.injectDelay({ routeId: "R-1", orderId: "ORDER-001", minutes: 15 });
  const delayedRoute = controller.model.schedules.find((route) => route.routeId === "R-1");
  const delayedFirst = delayedRoute.stops[0];
  check("13_delay_status_and_propagation", Replay.vehicleStateAt(delayedRoute, delayedFirst.delayStartMinute + 1).status === Replay.VEHICLE_STATUS.SIMULATED_DELAY
    && delayedRoute.stops[1].propagatedDelayMin > 0);
  check("14_delay_does_not_change_plan_hash", controller.model.planHash === planHashBefore);
  controller.resetSimulation();
  check("15_reset_restores_schedule", controller.model.schedules.find((route) => route.routeId === "R-1").returnMinute === route1.returnMinute);

  const riskController = Replay.createReplayController(plan, scenario);
  riskController.injectDelay({ routeId: "R-1", orderId: "ORDER-001", minutes: 60 });
  const riskStop = riskController.model.schedules.find((route) => route.routeId === "R-1").stops[1];
  check("16_delay_marks_window_risk", riskStop.missedWindow || riskStop.atRisk);

  const sameMinute = model.startMinute + 75;
  const webgl = Replay.stateAt(Replay.buildReplayModel(plan, scenario, { webglAvailable: true }), sameMinute);
  const noWebgl = Replay.stateAt(Replay.buildReplayModel(plan, scenario, { webglAvailable: false }), sameMinute);
  check("17_no_webgl_same_state", JSON.stringify(webgl) === JSON.stringify(noWebgl));

  const reduced = Replay.createReplayController(plan, scenario, { reducedMotion: true, speed: 4 });
  reduced.play();
  reduced.tick(125);
  check("18_reduced_motion_uses_discrete_ticks", Number.isInteger(reduced.state.currentMinute));

  const twenty = buildFixture({ orderCount: 20, routeCount: 7, planSuffix: "20" });
  const sixty = buildFixture({ orderCount: 60, routeCount: 7, planSuffix: "60" });
  const oneTwenty = buildFixture({ orderCount: 120, routeCount: 7, planSuffix: "120" });
  const twoForty = buildFixture({ orderCount: 240, routeCount: 7, planSuffix: "240" });
  check("19_target_20_stops_7_vehicles", Replay.buildReplayModel(twenty.plan, twenty.scenario).schedules.length === 7 && twenty.plan.stopGeoJson.features.length === 20);
  check("20_target_60_stops_7_vehicles", Replay.buildReplayModel(sixty.plan, sixty.scenario).schedules.length === 7 && sixty.plan.stopGeoJson.features.length === 60);
  check("21_target_120_stops_7_vehicles", Replay.buildReplayModel(oneTwenty.plan, oneTwenty.scenario).schedules.length === 7 && oneTwenty.plan.stopGeoJson.features.length === 120);
  check("22_target_240_stops_7_vehicles", Replay.buildReplayModel(twoForty.plan, twoForty.scenario).schedules.length === 7 && twoForty.plan.stopGeoJson.features.length === 240);

  const invalid = clone(plan);
  invalid.verification.status = "FAIL";
  assert.throws(() => Replay.buildReplayModel(invalid, scenario), /VERIFIER_NOT_PASS/);
  process.stdout.write("PASS 23_invalid_plan_blocked\n");

  const dateLine = Replay.interpolateCoordinate([179, 10], [-179, 20], 0.5);
  check("24_longitude_boundary_short_path", Math.abs(Math.abs(dateLine[0]) - 180) < 1e-9 && dateLine[1] === 15);

  const events = Replay.replayEvents(model);
  const partialEvents = Replay.stateAt(model, first1.departureMinute).events;
  check("25_event_feed_is_time_bounded", partialEvents.length < events.length && partialEvents.every((event) => event.minute <= first1.departureMinute));
  const pulse = Replay.stateAt(model, model.endMinute).fleetPulse;
  check("26_fleet_pulse_recomputed", pulse.completedStops === pulse.totalStops && pulse.progress === 100 && pulse.activeVehicles === 0);

  console.log("PASS replay v1.4 deterministic model");
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
