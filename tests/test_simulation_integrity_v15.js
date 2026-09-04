"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Simulation = require("../simulation-store-v15.js");
const Experience = require("../experience-v15.js");
const Replay = require("../replay-v15.js");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

const checks = [];

function check(id, condition, detail = "") {
  assert(condition, `${id}${detail ? `: ${detail}` : ""}`);
  checks.push(id);
}

function event(overrides = {}) {
  return {
    eventId: "EVENT-A",
    type: "DELAY",
    routeId: "R-1",
    orderId: "ORDER-001",
    stopIndex: 0,
    minutes: 15,
    source: "test",
    ...overrides,
  };
}

function delayHash(delayNonEmpty = 15) {
  return async (payload) => {
    const parsed = JSON.parse(payload);
    await new Promise((resolve) => setTimeout(resolve, parsed.activeEvents.length ? delayNonEmpty : 1));
    return `test:${Buffer.from(payload).toString("base64url")}`;
  };
}

async function main() {
  const phase0 = "/tmp/lospollos-v1.5-baseline-20260830_230200/known-failures/F14-01/before-evidence.json";
  const beforeEvidence = JSON.parse(fs.readFileSync(phase0, "utf8"));
  check("T001", beforeEvidence.reproduced === true && beforeEvidence.afterUndo.replayRemainingEventIds.join() !== beforeEvidence.afterUndo.experienceRemainingEventIds.join());

  const fixture = buildFixture({ orderCount: 4, routeCount: 2, planSuffix: "SIM-A", inputSuffix: "SIM" });
  const store = Simulation.createSimulationStore();
  await store.initialize(fixture.plan);
  const emptyHash = store.state.simulationHash;
  await store.addEvent(event({ eventId: "EVENT-R2", routeId: "R-2", orderId: "ORDER-004", stopIndex: 1, minutes: 30 }));
  await store.addEvent(event({ eventId: "EVENT-R1" }));
  const canonicalOrder = store.state.activeEvents.map((row) => row.eventId);
  const operationOrder = store.state.operationLog.map((row) => row.eventId);
  await store.undo();
  check("T002", store.state.activeEvents.length === 1 && store.state.activeEvents[0].eventId === "EVENT-R2");
  check("T003", canonicalOrder.join() === "EVENT-R1,EVENT-R2" && operationOrder.join() === "EVENT-R2,EVENT-R1");

  const unorderedA = [event({ eventId: "E2", routeId: "R-2", orderId: "ORDER-004", stopIndex: 1 }), event({ eventId: "E1" })];
  const unorderedB = [...unorderedA].reverse();
  check("T004", await Simulation.simulationIdentity(fixture.plan.planHash, unorderedA) === await Simulation.simulationIdentity(fixture.plan.planHash, unorderedB));

  const historyA = Simulation.createSimulationStore();
  const historyB = Simulation.createSimulationStore();
  await historyA.initialize(fixture.plan);
  await historyB.initialize(fixture.plan);
  await historyA.addEvent(event());
  await historyB.addEvent(event());
  await historyB.reset();
  await historyB.addEvent(event());
  check("T005", historyA.state.simulationHash === historyB.state.simulationHash && historyA.state.operationLog.length !== historyB.state.operationLog.length);

  const beforeUndoHash = historyA.state.simulationHash;
  await historyA.undo();
  check("T006", historyA.state.simulationHash === emptyHash);
  await historyA.redo();
  check("T007", historyA.state.simulationHash === beforeUndoHash);
  await historyA.reset();
  check("T008", historyA.state.activeEvents.length === 0 && historyA.state.operationLog.at(-1).action === "RESET");

  const race = Simulation.createSimulationStore({ hash: delayHash(25) });
  await race.initialize(fixture.plan);
  const addRace = race.addEvent(event({ eventId: "RACE-ADD" }));
  const resetRace = race.reset();
  await Promise.all([addRace, resetRace]);
  check("T009", race.state.activeEvents.length === 0 && JSON.parse(Buffer.from(race.state.simulationHash.slice(5), "base64url").toString()).activeEvents.length === 0);

  const undoRace = Simulation.createSimulationStore({ hash: delayHash(25) });
  await undoRace.initialize(fixture.plan);
  const addThenUndo = undoRace.addEvent(event({ eventId: "RACE-UNDO" }));
  const immediateUndo = undoRace.undo();
  await Promise.all([addThenUndo, immediateUndo]);
  check("T010", undoRace.state.activeEvents.length === 0);

  const directorRace = Simulation.createSimulationStore({ hash: delayHash(20) });
  await directorRace.initialize(fixture.plan);
  await Promise.all([directorRace.addEvent(event({ eventId: "DIRECTOR" })), directorRace.reset({ source: "director-leave" })]);
  check("T011", directorRace.state.activeEvents.length === 0 && directorRace.state.operationLog.at(-1).source === "director-leave");

  const second = buildFixture({ orderCount: 4, routeCount: 2, planSuffix: "SIM-B", inputSuffix: "SIM" });
  const experience = Experience.createExperience();
  await experience.open(fixture);
  await experience.addSimulationEvent(event({ eventId: "PLAN-RESET" }));
  await experience.selectPlan(second.plan, second.scenario);
  check("T012", experience.state.activeEvents.length === 0 && experience.state.activePlanHash === second.plan.planHash);

  await experience.addSimulationEvent(event({ eventId: "PLAN-REBASE" }));
  await experience.selectPlan(fixture.plan, fixture.scenario, { policy: "REBASE_COMPATIBLE" });
  check("T013", experience.state.activeEvents.some((row) => row.eventId === "PLAN-REBASE"));

  const noRoute = clone(second.plan);
  noRoute.planHash = "sha256:no-route";
  noRoute.verification.computedPlanHash = noRoute.planHash;
  noRoute.routes = noRoute.routes.filter((route) => route.routeId !== "R-1");
  const noRouteStore = Simulation.createSimulationStore();
  await noRouteStore.initialize(fixture.plan, [event({ eventId: "MISSING-ROUTE" })]);
  const noRouteResult = await noRouteStore.setActivePlan(noRoute, "REBASE_COMPATIBLE");
  check("T014", noRouteResult.report.rejectedEvents[0].reasonCode === "ROUTE_NOT_FOUND");

  const movedOrder = clone(second.plan);
  movedOrder.planHash = "sha256:moved-order";
  movedOrder.verification.computedPlanHash = movedOrder.planHash;
  movedOrder.routes[0].orderIds = movedOrder.routes[0].orderIds.filter((id) => id !== "ORDER-001");
  movedOrder.routes[1].orderIds.push("ORDER-001");
  const movedStore = Simulation.createSimulationStore();
  await movedStore.initialize(fixture.plan, [event({ eventId: "MOVED-ORDER" })]);
  const movedResult = await movedStore.setActivePlan(movedOrder, "REBASE_COMPATIBLE");
  check("T015", movedResult.report.rejectedEvents[0].reasonCode === "ORDER_NOT_IN_ROUTE");

  const manualExperience = Experience.createExperience();
  await manualExperience.open(fixture);
  await manualExperience.addSimulationEvent(event({ eventId: "MANUAL-RESTORE" }));
  const savedManualHash = manualExperience.state.simulationHash;
  await manualExperience.updateManualPlan(second.plan, second.scenario, [], { source: "manual-commit" });
  await manualExperience.updateManualPlan(fixture.plan, fixture.scenario, [], { source: "manual-undo", restoreSaved: true });
  check("T016", manualExperience.state.simulationHash === savedManualHash && manualExperience.state.activeEvents[0].eventId === "MANUAL-RESTORE");

  const expectedPlanHashIdentity = await Simulation.simulationIdentity(manualExperience.state.activePlanHash, manualExperience.state.activeEvents);
  check("T017", expectedPlanHashIdentity === manualExperience.state.simulationHash);

  const replay = Replay.createReplayController(fixture.plan, fixture.scenario, { simulationStore: manualExperience.simulationStore });
  check("T018", replay.simulationStore === manualExperience.simulationStore && !Object.prototype.hasOwnProperty.call(replay.state, "writableSimulationEvents"));

  const operations = manualExperience.state.simulationOperationLog;
  check("T019", new Set(operations.map((row) => row.operationId)).size === operations.length && operations.every((row) => row.operationId));
  check("T020", operations.every((row, index) => row.committedRevision === index + 1));

  let pendingResolver;
  const pendingStore = Simulation.createSimulationStore({
    hash: (payload) => {
      const parsed = JSON.parse(payload);
      if (!parsed.activeEvents.length) return Promise.resolve("pending:empty");
      return new Promise((resolve) => { pendingResolver = resolve; });
    },
  });
  await pendingStore.initialize(fixture.plan);
  const pendingAdd = pendingStore.addEvent(event({ eventId: "PENDING" }));
  while (!pendingResolver) await new Promise((resolve) => setTimeout(resolve, 0));
  pendingStore.destroy();
  pendingResolver("pending:stale-add");
  const pendingResult = await pendingAdd;
  check("T021", pendingResult.status === "STALE_RESULT" && pendingResult.snapshot.simulationRevision === 0);

  await assert.rejects(() => manualExperience.simulationStore.addEvent(event({ eventId: "MANUAL-RESTORE" })), (error) => error.code === "DUPLICATE_SIMULATION_EVENT");
  check("T022", true);
  const emptyUndoStore = Simulation.createSimulationStore();
  await emptyUndoStore.initialize(fixture.plan);
  const beforeEmptyUndo = emptyUndoStore.state;
  const emptyUndo = await emptyUndoStore.undo();
  check("T023", emptyUndo.status === "NO_OPERATION" && emptyUndoStore.state.simulationRevision === beforeEmptyUndo.simulationRevision && emptyUndoStore.state.simulationHash === beforeEmptyUndo.simulationHash);
  check("T024", pendingStore.state.status === "DESTROYED" && pendingStore.state.simulationRevision === 0);

  const cleanupExperience = Experience.createExperience();
  const execution = [];
  cleanupExperience.registerCleanup("test", () => execution.push("A"));
  cleanupExperience.registerCleanup("test", () => { execution.push("B"); throw Object.assign(new Error("B failed"), { code: "B_FAIL" }); });
  cleanupExperience.registerCleanup("test", () => execution.push("C"));
  const cleanupReport = cleanupExperience.destroyOwner("test");
  check("T025", execution.join() === "C,B,A");
  check("T026", cleanupReport.owner === "test" && cleanupReport.successCount === 2 && cleanupReport.failureCount === 1 && cleanupReport.errors[0].code === "B_FAIL" && cleanupExperience.destroyOwner("test").total === 0);

  const visibilityStore = Simulation.createSimulationStore();
  await visibilityStore.initialize(fixture.plan);
  const visibilityReplay = Replay.createReplayController(fixture.plan, fixture.scenario, { simulationStore: visibilityStore });
  visibilityReplay.play();
  visibilityReplay.tick(100);
  const hiddenMinute = visibilityReplay.state.currentMinute;
  visibilityReplay.handleVisibility(true);
  visibilityReplay.tick(5000);
  visibilityReplay.handleVisibility(false);
  check("T029", visibilityReplay.state.status === "paused" && visibilityReplay.state.currentMinute === hiddenMinute && visibilityReplay.state.pausedByVisibility === false);
  const reducedStore = Simulation.createSimulationStore();
  await reducedStore.initialize(fixture.plan);
  const reducedHash = reducedStore.state.simulationHash;
  const reducedReplay = Replay.createReplayController(fixture.plan, fixture.scenario, { simulationStore: reducedStore, reducedMotion: true });
  reducedReplay.play();
  reducedReplay.tick(1550);
  check("T030", Number.isInteger(reducedReplay.state.currentMinute) && reducedStore.state.simulationHash === reducedHash);

  replay.destroy();
  visibilityReplay.destroy();
  reducedReplay.destroy();
  experience.destroy();
  manualExperience.destroy();
  cleanupExperience.destroy();
  [store, historyA, historyB, race, undoRace, directorRace, noRouteStore, movedStore, emptyUndoStore, visibilityStore, reducedStore].forEach((item) => item.destroy());

  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks, phase0: path.dirname(phase0) }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
