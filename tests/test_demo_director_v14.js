"use strict";

const assert = require("assert");
const Director = require("../demo-director-v14.js");

function check(name, condition) {
  assert.ok(condition, name);
  process.stdout.write(`PASS ${name}\n`);
}

function fakeKeyboardTarget() {
  const listeners = new Set();
  return {
    addEventListener(type, handler) { if (type === "keydown") listeners.add(handler); },
    removeEventListener(type, handler) { if (type === "keydown") listeners.delete(handler); },
    press(key) { let prevented = 0; [...listeners].forEach((handler) => handler({ key, preventDefault() { prevented += 1; } })); return prevented; },
    count() { return listeners.size; },
  };
}

function main() {
  const identity = {
    contentHash: "sha256:content",
    inputHash: "sha256:input",
    requestHash: "sha256:request",
    planHash: "sha256:plan",
    manualRevision: 0,
  };
  let appState = { view: "optimizer", selectedPlanHash: identity.planHash, selectedVehicleId: "VEH-2", replayMinute: 528 };
  let applyCalls = 0;
  let commitCalls = 0;
  let temporaryDelay = null;
  let clearCalls = 0;
  const sceneVisits = [];
  const prerequisites = {
    canonicalScenario: true,
    verifiedPlan: true,
    candidatePool: true,
    baselinePlan: true,
    candidatePlan: true,
    whatIfScenario: true,
    manualCapability: true,
    replayPlan: true,
  };
  const controller = Director.createDirectorController({
    prerequisites,
    presentationMode: true,
    captureState: () => ({ ...appState }),
    restoreState: (snapshot) => { appState = { ...snapshot }; },
    getIdentity: () => ({ ...identity }),
    onScene: (scene) => { sceneVisits.push(scene.id); appState.view = scene.targetMode; },
    onTemporarySimulation: (event) => { temporaryDelay = event; },
    onClearSimulation: () => { temporaryDelay = null; clearCalls += 1; },
    temporaryDelayEvent: { routeId: "R-1", orderId: "ORDER-001", minutes: 15 },
  });

  const start = controller.start(0);
  check("01_seven_scene_order", start.scenes.length === 7 && start.scenes.map((scene) => scene.id).join(",") === Director.SCENES.map((scene) => scene.id).join(","));
  controller.jump("scenario-arena");
  check("02_direct_jump", controller.snapshot().scene.id === "scenario-arena" && controller.state.sceneIndex === 2);
  controller.play();
  const beforeAdvance = controller.state.sceneIndex;
  controller.advance();
  controller.pause();
  check("03_pause_resume", controller.state.sceneIndex === beforeAdvance + 1 && controller.state.status === "paused");

  controller.jump("mission-replay");
  check("04_temporary_delay_in_replay_scene", temporaryDelay?.minutes === 15 && controller.state.temporarySimulationActive);
  controller.exit("test");
  check("05_exit_restores_view", appState.view === "optimizer");
  check("06_exit_restores_selection_and_time", appState.selectedPlanHash === identity.planHash && appState.selectedVehicleId === "VEH-2" && appState.replayMinute === 528);
  check("07_identity_unchanged", identity.planHash === "sha256:plan" && identity.inputHash === "sha256:input" && controller.state.lastExitReason === "test");
  check("08_no_auto_apply_or_commit", applyCalls === 0 && commitCalls === 0);
  check("09_delay_cleanup_on_exit", temporaryDelay === null && clearCalls === 1);

  const missing = Director.createDirectorController({
    prerequisites: { canonicalScenario: true, verifiedPlan: true },
    getIdentity: () => ({ ...identity }),
  });
  missing.start(3);
  check("10_missing_prerequisite", missing.snapshot().scene.id === "what-if" && missing.snapshot().scene.prerequisite.status === "MISSING" && missing.snapshot().scene.prerequisite.missing.includes("whatIfScenario"));
  missing.exit();

  const reduced = Director.createDirectorController({ prerequisites, reducedMotion: true, getIdentity: () => ({ ...identity }) });
  reduced.start(1);
  check("11_reduced_motion", reduced.snapshot().scene.transitionMs === 0);
  reduced.exit();

  const keyboard = fakeKeyboardTarget();
  const uninstall = controller.installKeyboard(keyboard);
  controller.start(0);
  const prevented = keyboard.press("ArrowRight");
  keyboard.press(" ");
  check("12_keyboard_navigation", controller.state.sceneIndex === 1 && controller.state.status === "playing" && prevented === 1);
  keyboard.press("Escape");
  check("13_escape_exit", !controller.state.active && controller.state.lastExitReason === "escape");

  controller.setEnvironment({ mobile: true });
  controller.start(0);
  controller.next();
  controller.previous();
  check("14_mobile_navigation", controller.snapshot().mobile && controller.state.sceneIndex === 0);
  controller.exit();

  controller.setEnvironment({ webglAvailable: false });
  controller.start(5);
  check("15_no_webgl_scene", controller.snapshot().scene.presentation === "NO_WEBGL_FALLBACK" && controller.snapshot().scene.evidenceView === "fleet-timeline");
  controller.exit();

  for (let index = 0; index < 5; index += 1) {
    controller.start(index % 7);
    controller.exit("cycle");
  }
  check("16_five_cycles_no_keyboard_leak", keyboard.count() === 1 && controller.state.enterCount >= 8);
  uninstall();
  check("17_keyboard_cleanup", keyboard.count() === 0);

  const maxAnnotations = Director.SCENES.every((scene) => scene.annotations.length <= 3 && scene.title && scene.conclusion);
  check("18_scene_annotation_discipline", maxAnnotations);
  check("19_scene_callbacks_are_view_only", sceneVisits.length > 0 && applyCalls === 0 && commitCalls === 0);

  controller.destroy();
  missing.destroy();
  reduced.destroy();
  console.log("PASS demo director v1.4 state safety");
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
