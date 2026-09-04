"use strict";

const assert = require("assert");
const Experience = require("../experience-v14.js");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

async function main() {
  const { scenario, plan } = buildFixture();
  const controller = Experience.createExperience({ reducedMotion: false, webglAvailable: true });
  const protectedBefore = Experience.planIdentity(plan, scenario);
  let openEvents = 0;
  let closeEvents = 0;
  let modeEvents = 0;
  controller.on(Experience.EVENT_NAMES.open, () => { openEvents += 1; });
  controller.on(Experience.EVENT_NAMES.close, () => { closeEvents += 1; });
  const removeMode = controller.on(Experience.EVENT_NAMES.mode, () => { modeEvents += 1; });

  for (let index = 0; index < 5; index += 1) {
    let cleanupCalls = 0;
    await controller.open({ scenario, plan, mode: "replay" });
    controller.registerCleanup("session", () => { cleanupCalls += 1; });
    controller.setMode("arena");
    controller.setMode("timeline");
    controller.setMode("director");
    controller.setMode("replay");
    controller.selectVehicle("VEH-1");
    controller.selectOrder("ORDER-001");
    controller.setComparison(plan.planHash, plan.planHash);
    controller.setReplayState({ status: "paused", currentMinute: 525 });
    controller.setTimelineState({ lens: "capacity", selectedOrderId: "ORDER-001" });
    controller.setStoryState({ sceneIndex: 2, playing: false });
    assert.deepStrictEqual(controller.assertIdentity(), protectedBefore, "visual actions preserve protected identity");
    controller.close({ reason: "test" });
    assert.strictEqual(cleanupCalls, 1, "session cleanup runs exactly once");
  }

  assert.strictEqual(openEvents, 5, "five opens emit five events");
  assert.strictEqual(closeEvents, 5, "five closes emit five events");
  assert.strictEqual(modeEvents, 20, "no duplicate mode listener after repeated open/close");

  await controller.open({ scenario, plan, mode: "replay" });
  const emptySimulationHash = controller.state.simulationHash;
  await controller.addSimulationEvent({ routeId: "R-1", orderId: "ORDER-001", stopIndex: 0, minutes: 15 });
  assert.notStrictEqual(controller.state.simulationHash, emptySimulationHash, "delay creates independent simulationHash");
  assert.strictEqual(controller.state.activePlanHash, plan.planHash, "delay does not change planHash");
  assert.strictEqual(controller.state.inputHash, scenario.inputHash, "delay does not change inputHash");
  await controller.undoSimulationEvent();
  assert.strictEqual(controller.state.simulationHash, emptySimulationHash, "undo restores deterministic empty simulationHash");
  await controller.addSimulationEvent({ routeId: "R-1", orderId: "ORDER-001", minutes: 30 });
  await controller.resetSimulation();
  assert.strictEqual(controller.state.simulationHash, emptySimulationHash, "reset restores simulation identity");

  const second = buildFixture({ planSuffix: "B" });
  await controller.selectPlan(second.plan, second.scenario);
  assert.strictEqual(controller.state.activePlanHash, second.plan.planHash, "verified plan selection succeeds");
  assert.strictEqual(controller.state.recomputedMetrics.assigned, second.plan.verification.recomputedMetrics.assigned, "state reads recomputed metrics");

  const invalid = clone(second.plan);
  invalid.verification.status = "FAIL";
  await assert.rejects(() => controller.selectPlan(invalid, second.scenario), /Plan selection rejected/, "invalid plan selection is blocked");
  const stale = clone(second.plan);
  stale.inputHash = "sha256:stale";
  await assert.rejects(() => controller.selectPlan(stale, second.scenario), /PLAN_INPUT_HASH_MISMATCH/, "stale plan is blocked");
  const missingMetrics = clone(second.plan);
  delete missingMetrics.verification.recomputedMetrics;
  await assert.rejects(() => controller.selectPlan(missingMetrics, second.scenario), /MISSING_RECOMPUTED_METRICS/, "reported metrics alone are rejected");

  const manual = clone(second.plan);
  manual.manualRevision = 1;
  manual.planHash = "sha256:manual-plan";
  manual.verification.computedPlanHash = manual.planHash;
  controller.updateManualPlan(manual, second.scenario, [{ actionType: "MOVE_ORDER", verifierStatus: "PASS" }]);
  assert.strictEqual(controller.state.identity.manualRevision, 1, "manual lineage updates only after verified plan update");
  assert.strictEqual(controller.state.manualLineage.length, 1, "manual lineage retained");

  removeMode();
  controller.setMode("arena");
  assert.strictEqual(modeEvents, 20, "removed listener does not fire");
  controller.close();
  controller.destroy();
  assert.throws(() => controller.reset(), /destroyed/, "destroyed controller cannot be reused");

  const eventA = { routeId: "R-2", orderId: "ORDER-004", minutes: 30, stopIndex: 2, eventId: "SIM-2" };
  const eventB = { routeId: "R-1", orderId: "ORDER-001", minutes: 15, stopIndex: 0, eventId: "SIM-1" };
  const hashA = await Experience.simulationIdentity(plan.planHash, [eventA, eventB]);
  const hashB = await Experience.simulationIdentity(plan.planHash, [eventB, eventA]);
  assert.strictEqual(hashA, hashB, "simulation events canonicalize deterministically");
  assert.ok(hashA.startsWith("sha256:"), "simulation identity uses SHA-256");

  console.log("PASS experience state isolation v1.4");
  console.log(JSON.stringify({ openEvents, closeEvents, modeEvents, simulationHash: hashA }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
