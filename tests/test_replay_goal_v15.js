"use strict";

const assert = require("assert");
const Simulation = require("../simulation-store-v15.js");
const Experience = require("../experience-v15.js");
const Replay = require("../replay-v15.js");
const Timeline = require("../timeline-v15.js");
const { buildFixture } = require("./experience_fixture_v14.js");

const checks = [];

function check(id, condition, detail = "") {
  assert(condition, `${id}${detail ? `: ${detail}` : ""}`);
  checks.push(id);
}

async function main() {
  const fixture = buildFixture({ orderCount: 60, routeCount: 7, planSuffix: "REPLAY-60", inputSuffix: "REPLAY" });
  const experience = Experience.createExperience();
  await experience.open(fixture);
  const replay = Replay.createReplayController(fixture.plan, fixture.scenario, { simulationStore: experience.simulationStore, selectedVehicleId: "VEH-2" });

  check("T031", Replay.VEHICLE_SCOPES.join() === "ALL,SINGLE" && replay.state.vehicleScope === "SINGLE");
  replay.setFollow(true);
  replay.setVehicleScope("ALL");
  const allScope = replay.snapshot();
  check("T032", allScope.frame.vehicles.length === 7 && allScope.followVehicle === false && allScope.frame.fleetSummary.vehicles === 7);
  replay.selectVehicle("VEH-3");
  check("T033", replay.state.vehicleScope === "SINGLE" && replay.state.selectedVehicleId === "VEH-3");

  await replay.injectDelay({ routeId: "R-3", orderId: "ORDER-003", minutes: 15, eventId: "REPLAY-EXCEPTION" });
  replay.setTime(replay.state.endMinute);
  replay.setEventFilter("ALL");
  const allEvents = replay.snapshot().frame.events;
  check("T034", allEvents.length > 0 && allEvents.some((event) => event.type === "DEPARTED") && allEvents.some((event) => event.type === "SERVICE_COMPLETED"));
  replay.setEventFilter("EXCEPTION");
  const exceptionEvents = replay.snapshot().frame.events;
  check("T035", exceptionEvents.length > 0 && exceptionEvents.every((event) => Replay.EXCEPTION_TYPES.has(event.type)));
  replay.setEventFilter("SELECTED_VEHICLE");
  const vehicleEvents = replay.snapshot().frame.events;
  check("T036", vehicleEvents.length > 0 && vehicleEvents.every((event) => event.vehicleId === "VEH-3"));
  const hashesBeforeFilter = { planHash: fixture.plan.planHash, simulationHash: experience.state.simulationHash };
  replay.setEventFilter("ALL");
  replay.setEventFilter("EXCEPTION");
  replay.setEventFilter("SELECTED_VEHICLE");
  check("T037", fixture.plan.planHash === hashesBeforeFilter.planHash && experience.state.simulationHash === hashesBeforeFilter.simulationHash);

  const departed = Replay.allReplayEvents(replay.model).find((event) => event.type === "DEPARTED" && event.vehicleId === "VEH-2");
  replay.setTime(replay.state.endMinute - 1);
  replay.play();
  const departedJump = replay.jumpToEvent(departed.eventId);
  check("T038", departedJump.status === "paused" && departedJump.currentMinute === departed.minute && departedJump.selectedVehicleId === departed.vehicleId);
  const stopEvent = Replay.allReplayEvents(replay.model).find((event) => event.type === "ARRIVED" && event.orderId);
  replay.play();
  const stopJump = replay.jumpToEvent(stopEvent.eventId);
  check("T039", stopJump.status === "paused" && stopJump.currentMinute === stopEvent.minute && stopJump.selectedVehicleId === stopEvent.vehicleId && stopJump.selectedOrderId === stopEvent.orderId);

  experience.selectVehicle(stopJump.selectedVehicleId);
  experience.selectOrder(stopJump.selectedOrderId, "test-event-seek");
  experience.setReplayState({ ...stopJump, frame: undefined });
  const timeline = Timeline.createTimelineController(fixture.plan, fixture.scenario, { replayCursorMinute: experience.state.replayState.currentMinute, selectedOrderId: experience.state.selectedOrderId });
  check("T040", timeline.state.replayCursorMinute === stopEvent.minute && timeline.state.selectedOrderId === stopEvent.orderId);

  replay.restart();
  const future = Replay.allReplayEvents(replay.model).find((event) => event.minute > replay.state.currentMinute + 20 && event.orderId);
  const futureJump = replay.jumpToEvent(future.eventId);
  check("T041", futureJump.currentMinute === future.minute && futureJump.status === "paused");
  check("T042", Replay.allReplayEvents(replay.model).every((event) => event.eventId && Number.isFinite(event.minute)));

  const large = buildFixture({ orderCount: 240, routeCount: 7, planSuffix: "REPLAY-240", inputSuffix: "REPLAY-240" });
  const largeStore = Simulation.createSimulationStore();
  await largeStore.initialize(large.plan);
  const largeReplay = Replay.createReplayController(large.plan, large.scenario, { simulationStore: largeStore });
  largeReplay.setTime(largeReplay.state.endMinute);
  const largeSnapshot = largeReplay.snapshot();
  check("T043", largeSnapshot.frame.events.length === Replay.EVENT_WINDOW_LIMIT && largeSnapshot.frame.eventCountBeforeWindow > 0);

  const markerHash = experience.state.simulationHash;
  replay.setStopMarkersVisible(false);
  check("T044", replay.state.stopMarkersVisible === false && experience.state.simulationHash === markerHash);
  const summary = Replay.routeSummary(replay.model, replay.state.selectedVehicleId);
  check("T045", summary && ["distanceKm", "plannedDurationMinutes", "waitingMinutes", "serviceMinutes", "delayedMinutes"].every((field) => Number.isFinite(summary[field])));

  replay.setVehicleScope("ALL");
  replay.setEventFilter("ALL");
  const directorSnapshot = { vehicleScope: replay.state.vehicleScope, eventFilter: replay.state.eventFilter, selectedVehicleId: replay.state.selectedVehicleId };
  check("T046", directorSnapshot.vehicleScope === "ALL" && directorSnapshot.eventFilter === "ALL");
  const restored = Replay.createReplayController(fixture.plan, fixture.scenario, { simulationStore: experience.simulationStore, ...directorSnapshot });
  check("T047", restored.state.vehicleScope === directorSnapshot.vehicleScope && restored.state.eventFilter === directorSnapshot.eventFilter);
  const noWebgl = Replay.createReplayController(fixture.plan, fixture.scenario, { simulationStore: experience.simulationStore, webglAvailable: false });
  const noWebglEvent = Replay.allReplayEvents(noWebgl.model).find((event) => event.orderId);
  check("T048", noWebgl.jumpToEvent(noWebglEvent.eventId).selectedOrderId === noWebglEvent.orderId && noWebgl.state.webglAvailable === false);

  [replay, largeReplay, restored, noWebgl].forEach((controller) => controller.destroy());
  experience.destroy();
  largeStore.destroy();

  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
