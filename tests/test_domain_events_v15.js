#!/usr/bin/env node
"use strict";

const assert = require("assert");
const DomainEvents = require("../domain-events-v15.js");
const Experience = require("../experience-v15.js");
const Replay = require("../replay-v15.js");
const { buildFixture, clone } = require("./experience_fixture_v14.js");

const checks = [];

function check(id, condition, detail = {}) {
  assert(condition, `${id}: ${JSON.stringify(detail)}`);
  checks.push(id);
}

function fields(overrides = {}) {
  return {
    aggregateType: "PLAN",
    aggregateId: "sha256:plan-a",
    scenarioId: "SCN-A",
    inputHash: "sha256:input-a",
    basePlanHash: "sha256:plan-a",
    source: "domain-event-test",
    logicalTime: "08:00",
    payload: {},
    ...overrides,
  };
}

async function main() {
  const store = DomainEvents.createEventStore({ clock: () => "2026-09-01T00:00:00.000Z" });
  const opened = store.append("SCENARIO_OPENED", fields({ aggregateType: "SCENARIO", aggregateId: "SCN-A" }));
  check("T066", DomainEvents.validateEvent(opened).status === "PASS", opened);
  const selected = store.append("PLAN_SELECTED", fields({ causationId: opened.eventId }));
  const applied = store.append("PLAN_APPLIED", fields({ causationId: selected.eventId, resultingPlanHash: "sha256:plan-a" }));
  check("T067", store.snapshot().every((event, index) => event.sequence === index + 1), store.snapshot().map((event) => event.sequence));
  check("T068", new Set(store.snapshot().map((event) => event.eventId)).size === store.state.eventCount);
  const chain = store.chain(applied.eventId);
  check("T069", chain.map((event) => event.eventId).join() === [opened.eventId, selected.eventId, applied.eventId].join() && chain.every((event) => event.correlationId === opened.correlationId), chain);
  check("T070", opened.logicalTime === "08:00" && opened.recordedAt === "2026-09-01T00:00:00.000Z" && opened.logicalTime !== opened.recordedAt, opened);

  const differentClock = DomainEvents.createEventStore({ clock: () => "2035-01-01T00:00:00.000Z" });
  const deterministicA = DomainEvents.createEventStore({ clock: () => "2026-01-01T00:00:00.000Z" }).append("SCENARIO_OPENED", fields({ aggregateType: "SCENARIO", aggregateId: "SCN-A" }));
  const deterministicB = differentClock.append("SCENARIO_OPENED", fields({ aggregateType: "SCENARIO", aggregateId: "SCN-A" }));
  check("T071", deterministicA.recordedAt !== deterministicB.recordedAt && deterministicA.eventId === deterministicB.eventId && deterministicA.eventHash === deterministicB.eventHash, { deterministicA, deterministicB });

  const fixtureA = buildFixture({ orderCount: 6, routeCount: 2, planSuffix: "EVENT-A", inputSuffix: "EVENT" });
  const fixtureB = buildFixture({ orderCount: 6, routeCount: 2, planSuffix: "EVENT-B", inputSuffix: "EVENT" });
  const experience = Experience.createExperience({ eventClock: () => "2026-09-01T00:00:00.000Z" });
  await experience.open(fixtureA);
  await experience.selectPlan(fixtureB.plan, fixtureB.scenario, { operationId: "SELECT-B" });
  const planEvents = experience.eventStore.filter({ type: "PLAN_SELECTED" });
  check("T072", planEvents.length === 2 && planEvents.at(-1).resultingPlanHash === fixtureB.plan.planHash, planEvents);

  await experience.updateManualPlan(fixtureA.plan, fixtureA.scenario, [{ action: "MOVE", orderId: "ORDER-001" }], { operationId: "MANUAL-OK" });
  const invalidPlan = clone(fixtureB.plan);
  invalidPlan.verification.status = "FAIL";
  await assert.rejects(() => experience.updateManualPlan(invalidPlan, fixtureB.scenario, [], { operationId: "MANUAL-REJECT" }));
  const manualTypes = experience.eventStore.snapshot().filter((event) => event.type.startsWith("MANUAL_")).map((event) => event.type);
  check("T073", manualTypes.includes("MANUAL_OPERATION_PROPOSED") && manualTypes.includes("MANUAL_OPERATION_COMMITTED") && manualTypes.includes("MANUAL_OPERATION_REJECTED"), manualTypes);

  await experience.addSimulationEvent({ eventId: "DOMAIN-SIM", type: "DELAY", routeId: "R-1", orderId: "ORDER-001", stopIndex: 0, minutes: 15 });
  await experience.undoSimulationEvent();
  await experience.resetSimulation();
  const simulationTypes = experience.eventStore.snapshot().filter((event) => event.type.startsWith("SIMULATION_")).map((event) => event.type);
  check("T074", simulationTypes.includes("SIMULATION_EVENT_ADDED") && simulationTypes.includes("SIMULATION_EVENT_UNDONE") && simulationTypes.includes("SIMULATION_RESET"), simulationTypes);

  const incident = experience.appendDomainEvent("INCIDENT_INJECTED", fields({ aggregateType: "INCIDENT", aggregateId: "INC-1", incidentHash: "sha256:incident", payload: { vehicleId: "VEH-1" } }));
  const cleared = experience.appendDomainEvent("INCIDENT_CLEARED", fields({ aggregateType: "INCIDENT", aggregateId: "INC-1", incidentHash: "sha256:incident", causationId: incident.eventId }));
  check("T075", cleared.causationId === incident.eventId && experience.eventStore.chain(cleared.eventId).length === 2);
  const recoveryGenerated = experience.appendDomainEvent("RECOVERY_CANDIDATE_GENERATED", fields({ aggregateType: "RECOVERY", aggregateId: "REC-1", resultingPlanHash: "sha256:recovery" }));
  const recoveryVerified = experience.appendDomainEvent("RECOVERY_CANDIDATE_VERIFIED", fields({ aggregateType: "RECOVERY", aggregateId: "REC-1", resultingPlanHash: "sha256:recovery", causationId: recoveryGenerated.eventId, payload: { status: "PASS" } }));
  check("T076", recoveryVerified.payload.status === "PASS" && experience.eventStore.chain(recoveryVerified.eventId).length === 2);

  experience.appendDomainEvent("SIMULATION_EVENT_ADDED", fields({ aggregateType: "SIMULATION", aggregateId: "SIM-X", payload: { vehicleId: "VEH-X", routeId: "R-X", orderId: "ORDER-X" } }));
  const filterSource = experience.eventStore;
  check("T077", filterSource.filter({ type: "SIMULATION_EVENT_ADDED", vehicleId: "VEH-X", routeId: "R-X", orderId: "ORDER-X" }).length === 1);
  const hostile = store.append("OPERATION_FAILED", fields({ payload: { message: '<img src=x onerror="alert(1)">' } }));
  const safeHtml = DomainEvents.safeEventHtml(hostile);
  check("T078", !safeHtml.includes("<img") && safeHtml.includes("&lt;img"), safeHtml);
  const exported = store.exportEvents();
  const exportedEvents = JSON.parse(exported).events;
  check("T079", exportedEvents.every((event, index) => event.sequence === index + 1), exportedEvents.map((event) => event.sequence));

  const imported = DomainEvents.createEventStore();
  imported.importEvents(exported);
  const tampered = JSON.parse(exported);
  tampered.events[0].payload.tampered = true;
  await assert.rejects(async () => imported.importEvents(tampered), (error) => error.code === "EVENT_HASH_MISMATCH");
  check("T080", imported.eventStreamHash() === store.eventStreamHash());
  assert.throws(() => store.append("UNKNOWN_EVENT", fields()), (error) => error.code === "UNKNOWN_DOMAIN_EVENT_TYPE");
  check("T081", true);
  const beforeDedupe = store.state.eventCount;
  const firstDedupe = store.append("CANDIDATE_GENERATED", fields({ aggregateType: "CANDIDATE", aggregateId: "CAND-A" }), { dedupeKey: "BUSINESS-OP-1" });
  const secondDedupe = store.append("CANDIDATE_GENERATED", fields({ aggregateType: "CANDIDATE", aggregateId: "CAND-A" }), { dedupeKey: "BUSINESS-OP-1" });
  check("T082", firstDedupe.eventId === secondDedupe.eventId && store.state.eventCount === beforeDedupe + 1);
  const failed = store.appendFailure("CANDIDATE_GENERATED", Object.assign(new Error("solver failed"), { code: "SOLVER_FAIL" }), fields({ aggregateType: "CANDIDATE", aggregateId: "CAND-FAIL" }));
  check("T083", failed.type === "OPERATION_FAILED" && failed.payload.status === "FAILED" && !store.snapshot().some((event) => event.type === "CANDIDATE_VERIFIED" && event.aggregateId === "CAND-FAIL"), failed);

  const replay = Replay.createReplayController(fixtureA.plan, fixtureA.scenario, { simulationStore: experience.simulationStore, eventStore: experience.eventStore });
  check("T084", replay.eventStore === experience.eventStore && JSON.stringify(replay.eventLane({ type: "PLAN_SELECTED" })) === JSON.stringify(experience.eventStore.filter({ type: "PLAN_SELECTED" })));
  const replayed = DomainEvents.createEventStore();
  const streamExport = experience.eventStore.exportEvents();
  replayed.importEvents(streamExport);
  check("T085", replayed.eventStreamHash() === experience.eventStore.eventStreamHash() && replayed.snapshot().length === experience.eventStore.snapshot().length);

  replay.destroy();
  experience.destroy();
  store.destroy();
  differentClock.destroy();
  imported.destroy();
  replayed.destroy();

  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
