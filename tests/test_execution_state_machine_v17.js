#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Integrity = require("../integrity-hash-v151.js");
const Twin = require("../execution-twin-v16.js");
const Invariants = require("../execution-invariants-v17.js");
const Reducer = require("../execution-reducer-v17.js");
const Capsule = require("../operational-capsule-v17.js");
const ShiftReview = require("../shift-review-v17.js");

const assertions = [];
function check(requirementId, condition, observed, expected) {
  assert(condition, `${requirementId}: observed=${JSON.stringify(observed)} expected=${JSON.stringify(expected)}`);
  assertions.push({ assertionId: `${requirementId}-A1`, requirementId, status: "PASS", observed, expected, evidence: "tests/test_execution_state_machine_v17.js" });
}

function makePlan(orderIds = ["O1", "O2"], suffix = "BASE") {
  const plan = { schemaVersion: "stct-plan-v1.7-test", planId: `PLAN-${suffix}`, revision: 1, logicalStartMinute: 480, verification: { status: "PASS" }, routes: [{ routeId: "R1", vehicleId: "V1", orderIds, geometry: [[130.7, 32.8], [130.71, 32.81], [130.72, 32.82]] }] };
  plan.planHash = Integrity.hashValue({ planId: plan.planId, orderIds });
  return plan;
}

function makeRun(plan, suffix = "BASE") {
  return Twin.createRun({ scenarioId: `SCENARIO-${suffix}`, inputHash: Integrity.hashValue({ input: suffix }), planHash: plan.planHash, routeGeometryHash: Integrity.hashValue(plan.routes.map((route) => route.geometry)), matrixHash: Integrity.hashValue({ matrix: suffix }), providerProvenance: { providerId: "SYNTHETIC_ROAD_FIXTURE" }, simulationSeed: "17", executionProfile: "ON_TIME", logicalStartMinute: 480, revision: 1 });
}

function fixture(orderIds = ["O1", "O2"], options = {}) {
  const plan = makePlan(orderIds, options.suffix || orderIds.join("-")); const run = makeRun(plan, options.suffix || orderIds.join("-"));
  const store = Reducer.createStore({ run, plan, noWebGL: options.noWebGL, mode: options.mode, pendingQueueConflicts: options.pendingQueueConflicts });
  let sequence = 0; let logicalTime = 480;
  function event(eventType, fields = {}) {
    sequence += 1; logicalTime = Math.max(logicalTime, fields.logicalTime ?? logicalTime + 1);
    const runEvent = ["RUN_RELEASED", "RUN_PAUSED", "RUN_RESUMED", "RUN_CANCELLED", "RUN_COMPLETED", "NETWORK_OFFLINE", "NETWORK_RESTORED", "EVENT_ACKNOWLEDGED"].includes(eventType);
    return Reducer.createEvent(run, { eventId: fields.eventId || `${options.suffix || "E"}-${sequence}-${eventType}`, sequence, eventType, logicalTime, routeId: fields.routeId ?? (runEvent ? "" : "R1"), vehicleId: fields.vehicleId ?? (runEvent ? "" : "V1"), orderId: fields.orderId || "", coordinate: fields.coordinate, roadEdgeId: fields.roadEdgeId, source: fields.source || "LOCAL_SIMULATION", clientEventId: fields.clientEventId, idempotencyKey: fields.idempotencyKey, payload: { planRevision: 1, ...(fields.payload || {}) } });
  }
  function append(eventType, fields = {}) { return store.append(event(eventType, fields)); }
  function releaseDepart() { append("RUN_RELEASED"); append("ROUTE_ACCEPTED"); append("VEHICLE_DEPARTED"); return store.snapshot(); }
  return { plan, run, store, event, append, releaseDepart, sequence: () => sequence, logicalTime: () => logicalTime };
}

function terminateRoute(method = "complete", orderIds = ["O1", "O2"], options = {}) {
  const f = fixture(orderIds, options); f.releaseDepart();
  for (const [index, orderId] of orderIds.entries()) {
    const action = Array.isArray(method) ? method[index] : method;
    if (action === "complete") { f.append("STOP_ARRIVED", { orderId }); f.append("SERVICE_STARTED", { orderId }); f.append("SERVICE_COMPLETED", { orderId }); }
    if (action === "skip") f.append("STOP_SKIPPED", { orderId });
    if (action === "fail") f.append("STOP_FAILED", { orderId });
    if (action === "cancel") f.append("ORDER_CANCELLED", { orderId });
  }
  return f;
}

function main() {
  {
    const f = fixture(); const initial = f.store.snapshot();
    check("T033", initial.routeCursors.R1.currentStopIndex === 0 && initial.routeCursors.R1.nextActionableStopId === "O1", initial.routeCursors.R1, { currentStopIndex: 0, nextActionableStopId: "O1" });
    const departed = f.releaseDepart(); check("T034", departed.stopStates.O1.state === "EN_ROUTE", departed.stopStates, { O1: "EN_ROUTE" });
    const arrived = f.append("STOP_ARRIVED", { orderId: "O1" }); check("T035", arrived.status === "ACCEPTED", arrived.status, "ACCEPTED");
  }
  for (const [id, eventType] of [["T036", "STOP_ARRIVED"], ["T037", "STOP_SKIPPED"], ["T038", "STOP_FAILED"], ["T039", "SERVICE_COMPLETED"]]) {
    const f = fixture(); f.releaseDepart(); const result = f.append(eventType, { orderId: "O2" });
    check(id, result.status === "REJECTED" && result.code === "EXECUTION_STOP_NOT_ACTIONABLE", { status: result.status, code: result.code }, { status: "REJECTED", code: "EXECUTION_STOP_NOT_ACTIONABLE" });
  }
  {
    const f = fixture(); f.releaseDepart(); f.append("STOP_ARRIVED", { orderId: "O1" }); f.append("SERVICE_STARTED", { orderId: "O1" }); f.append("SERVICE_COMPLETED", { orderId: "O1" });
    check("T040", f.store.snapshot().stopStates.O2.state === "EN_ROUTE" && f.store.snapshot().routeCursors.R1.nextActionableStopId === "O2", { stop: f.store.snapshot().stopStates.O2, cursor: f.store.snapshot().routeCursors.R1 }, { state: "EN_ROUTE", nextActionableStopId: "O2" });
  }
  for (const [id, eventType, terminal] of [["T041", "STOP_FAILED", "FAILED"], ["T042", "STOP_SKIPPED", "SKIPPED"], ["T043", "ORDER_CANCELLED", "CANCELLED"]]) {
    const f = fixture(); f.releaseDepart(); const result = f.append(eventType, { orderId: "O1" }); const state = f.store.snapshot();
    check(id, result.status === "ACCEPTED" && state.stopStates.O1.state === terminal && state.stopStates.O2.state === "EN_ROUTE", { result: result.status, O1: state.stopStates.O1.state, O2: state.stopStates.O2.state }, { result: "ACCEPTED", O1: terminal, O2: "EN_ROUTE" });
  }
  {
    const f = fixture(); f.releaseDepart(); const terminal = f.event("STOP_SKIPPED", { orderId: "O1" }); const first = f.store.append(terminal); const cursor = f.store.snapshot().routeCursors.R1; const duplicate = f.store.append(terminal);
    check("T044", first.status === "ACCEPTED" && duplicate.status === "DUPLICATE_IDEMPOTENT" && f.store.snapshot().routeCursors.R1.nextActionableStopId === cursor.nextActionableStopId, { first: first.status, duplicate: duplicate.status, cursor: f.store.snapshot().routeCursors.R1 }, { duplicate: "DUPLICATE_IDEMPOTENT", nextActionableStopId: "O2" });
  }
  {
    const f = fixture(["O1"]); f.releaseDepart(); f.append("STOP_ARRIVED", { orderId: "O1" }); f.append("SERVICE_STARTED", { orderId: "O1" }); const event = f.event("SERVICE_COMPLETED", { orderId: "O1" }); const first = f.store.append(event); const same = f.store.append(event); const second = f.append("SERVICE_COMPLETED", { orderId: "O1" });
    check("T045", first.status === "ACCEPTED" && same.status === "DUPLICATE_IDEMPOTENT" && second.status === "REJECTED", { first: first.status, same: same.status, second: second.status }, { first: "ACCEPTED", same: "DUPLICATE_IDEMPOTENT", second: "REJECTED" });
  }
  {
    const f = fixture(["O1"]); f.releaseDepart(); const event = f.event("STOP_SKIPPED", { orderId: "O1" }); const first = f.store.append(event); const same = f.store.append(event); const second = f.append("STOP_SKIPPED", { orderId: "O1" });
    check("T046", first.status === "ACCEPTED" && same.status === "DUPLICATE_IDEMPOTENT" && second.status === "REJECTED", { first: first.status, same: same.status, second: second.status }, { first: "ACCEPTED", same: "DUPLICATE_IDEMPOTENT", second: "REJECTED" });
  }
  {
    const f = fixture(); f.releaseDepart(); f.append("STOP_ARRIVED", { orderId: "O1" }); const arrived = f.store.snapshot();
    check("T047", arrived.routeStates.R1.activeStopId === arrived.routeCursors.R1.activeStopId && arrived.routeCursors.R1.nextActionableStopId === "O1", { route: arrived.routeStates.R1, cursor: arrived.routeCursors.R1 }, "active and cursor both O1");
    check("T048", arrived.routeStates.R1.activeStopId === "O1", arrived.routeStates.R1.activeStopId, "O1");
    f.append("SERVICE_STARTED", { orderId: "O1" }); check("T049", f.store.snapshot().routeStates.R1.activeStopId === "O1" && f.store.snapshot().stopStates.O1.state === "SERVING", { route: f.store.snapshot().routeStates.R1, stop: f.store.snapshot().stopStates.O1 }, { activeStopId: "O1", state: "SERVING" });
    f.append("SERVICE_COMPLETED", { orderId: "O1" }); check("T050", f.store.snapshot().routeStates.R1.activeStopId === "", f.store.snapshot().routeStates.R1.activeStopId, "");
  }
  {
    const completed = terminateRoute("complete", ["O1"]); check("T051", completed.store.snapshot().routeStates.R1.state === "COMPLETED", completed.store.snapshot().routeStates.R1.state, "COMPLETED");
    const skipped = terminateRoute("skip", ["O1"]); check("T052", skipped.store.snapshot().routeStates.R1.state === "COMPLETED_WITH_EXCEPTIONS", skipped.store.snapshot().routeStates.R1.state, "COMPLETED_WITH_EXCEPTIONS");
    const failed = terminateRoute("fail", ["O1"]); check("T053", ["COMPLETED_WITH_EXCEPTIONS", "FAILED"].includes(failed.store.snapshot().routeStates.R1.state), failed.store.snapshot().routeStates.R1.state, "COMPLETED_WITH_EXCEPTIONS or FAILED");
  }
  {
    const f = fixture(); f.releaseDepart(); f.append("VEHICLE_BREAKDOWN", { routeId: "R1", vehicleId: "V1" }); const broken = f.store.snapshot();
    check("T054", broken.routeStates.R1.state === "FAILED" && broken.vehicleStates.V1.available === false, { route: broken.routeStates.R1, vehicle: broken.vehicleStates.V1 }, { route: "FAILED", available: false });
    const completed = f.append("RUN_COMPLETED"); check("T055", completed.status === "ACCEPTED" && f.store.snapshot().routeStates.R1.state === "FAILED", { status: completed.status, route: f.store.snapshot().routeStates.R1.state }, { status: "ACCEPTED", route: "FAILED" });
  }
  {
    const f = fixture(); f.append("RUN_RELEASED"); const pending = f.append("RUN_COMPLETED");
    check("T056", pending.code === "RUN_COMPLETION_INVARIANT_FAILED" && pending.detail.nonTerminalStops.length === 2, pending.detail, "2 non-terminal stops");
  }
  for (const [id, setup, expectedStop] of [
    ["T057", (f) => f.releaseDepart(), "EN_ROUTE"],
    ["T058", (f) => { f.releaseDepart(); f.append("STOP_ARRIVED", { orderId: "O1" }); }, "ARRIVED"],
    ["T059", (f) => { f.releaseDepart(); f.append("STOP_ARRIVED", { orderId: "O1" }); f.append("SERVICE_STARTED", { orderId: "O1" }); }, "SERVING"],
  ]) {
    const f = fixture(["O1"]); setup(f); const result = f.append("RUN_COMPLETED");
    check(id, result.code === "RUN_COMPLETION_INVARIANT_FAILED" && Object.values(f.store.snapshot().stopStates).some((stop) => stop.state === expectedStop), { code: result.code, stopStates: f.store.snapshot().stopStates }, { code: "RUN_COMPLETION_INVARIANT_FAILED", stop: expectedStop });
  }
  {
    const f = terminateRoute("complete", ["O1"], { pendingQueueConflicts: [{ clientEventId: "C1" }] }); const result = f.append("RUN_COMPLETED");
    check("T060", result.code === "RUN_COMPLETION_INVARIANT_FAILED" && result.detail.pendingQueueConflicts.length === 1, result.detail, "one pending queue conflict");
  }
  {
    const f = terminateRoute(["complete", "skip"]); const result = f.append("RUN_COMPLETED"); const state = f.store.snapshot();
    check("T061", result.status === "ACCEPTED" && state.run.status === "COMPLETED", { status: result.status, run: state.run.status }, { status: "ACCEPTED", run: "COMPLETED" });
    check("T062", state.run.terminalSummary && Object.values(state.run.terminalSummary).every((rows) => rows.length === 0), state.run.terminalSummary, "empty terminal diagnostic arrays");
  }
  {
    const f = fixture(); f.append("RUN_RELEASED"); const paused = f.append("RUN_PAUSED");
    check("T063", paused.status === "ACCEPTED" && f.store.snapshot().run.status === "PAUSED", f.store.snapshot().run.status, "PAUSED");
    const resumed = f.append("RUN_RESUMED"); check("T064", resumed.status === "ACCEPTED" && f.store.snapshot().run.status === "RUNNING", f.store.snapshot().run.status, "RUNNING");
    const cancelled = f.append("RUN_CANCELLED"); check("T065", cancelled.status === "ACCEPTED" && f.store.snapshot().run.status === "CANCELLED", f.store.snapshot().run.status, "CANCELLED");
    const rejected = f.append("ROUTE_ACCEPTED"); check("T066", rejected.code === "EXECUTION_RUN_TERMINAL", rejected.code, "EXECUTION_RUN_TERMINAL");
  }
  {
    const f = terminateRoute("complete", ["O1"]); f.append("RUN_COMPLETED"); const after = f.append("UNPLANNED_STOP", { routeId: "R1", vehicleId: "V1" });
    check("T067", after.code === "EXECUTION_RUN_TERMINAL", after.code, "EXECUTION_RUN_TERMINAL");
  }
  {
    const f = fixture(); f.releaseDepart(); f.append("RUN_PAUSED"); const position = f.append("POSITION_RECORDED", { coordinate: [130.7, 32.8], roadEdgeId: "E1", payload: { derivedTelemetryHash: Integrity.hashValue({ d: 1 }), telemetryStatus: "PASS" } });
    check("T068", position.status === "ACCEPTED" && f.store.snapshot().run.status === "PAUSED", { status: position.status, run: f.store.snapshot().run.status }, { status: "ACCEPTED", run: "PAUSED", policy: "verified position allowed" });
  }
  {
    const reached = new Set([fixture().store.snapshot().run.status]); const f = fixture(); f.append("RUN_RELEASED"); reached.add(f.store.snapshot().run.status); f.append("ROUTE_ACCEPTED"); reached.add(f.store.snapshot().run.status); f.append("RUN_PAUSED"); reached.add(f.store.snapshot().run.status); f.append("RUN_CANCELLED"); reached.add(f.store.snapshot().run.status); const done = terminateRoute("complete", ["O1"]); done.append("RUN_COMPLETED"); reached.add(done.store.snapshot().run.status);
    check("T069", Invariants.RUN_STATUSES.every((status) => reached.has(status)), [...reached].sort(), [...Invariants.RUN_STATUSES].sort());
  }
  {
    const f = fixture(); const state = f.store.snapshot(); const input = f.event("RUN_RELEASED"); const stateBefore = JSON.stringify(state); const result = Reducer.reduce(state, f.plan, input);
    check("T070", result.status === "ACCEPTED" && JSON.stringify(state) === stateBefore, { result: result.status, inputUnchanged: JSON.stringify(state) === stateBefore }, { result: "ACCEPTED", inputUnchanged: true });
    check("T072", JSON.stringify(state) === stateBefore && input.eventHash === Reducer.createEvent(f.run, input).eventHash, { stateUnchanged: JSON.stringify(state) === stateBefore, eventHashStable: input.eventHash === Reducer.createEvent(f.run, input).eventHash }, { stateUnchanged: true, eventHashStable: true });
    const again = Reducer.reduce(state, f.plan, input); check("T073", again.state.executionStateHash === result.state.executionStateHash && JSON.stringify(again.state) === JSON.stringify(result.state), again.state.executionStateHash, result.state.executionStateHash);
  }
  {
    const f = fixture(); f.append("RUN_RELEASED");
    const invalidRoute = f.append("ROUTE_ACCEPTED", { routeId: "MISSING", vehicleId: "V1" }); check("T074", invalidRoute.code === "EXECUTION_ROUTE_NOT_FOUND", invalidRoute.code, "EXECUTION_ROUTE_NOT_FOUND");
  }
  {
    const f = fixture(); f.append("RUN_RELEASED"); const invalidVehicle = f.append("ROUTE_ACCEPTED", { routeId: "R1", vehicleId: "MISSING" });
    check("T075", invalidVehicle.code === "EXECUTION_ROUTE_VEHICLE_MISMATCH", invalidVehicle.code, "EXECUTION_ROUTE_VEHICLE_MISMATCH");
    check("T076", invalidVehicle.detail.expected === "V1" && invalidVehicle.detail.actual === "MISSING", invalidVehicle.detail, { expected: "V1", actual: "MISSING" });
  }
  {
    const plan = makePlan(["O1"], "MISMATCH"); plan.routes.push({ routeId: "R2", vehicleId: "V2", orderIds: ["O2"], geometry: [] }); const run = makeRun(plan, "MISMATCH"); const store = Reducer.createStore({ run, plan });
    const release = Reducer.createEvent(run, { eventId: "M-1", sequence: 1, eventType: "RUN_RELEASED", logicalTime: 481, payload: { planRevision: 1 } }); store.append(release);
    const mismatch = Reducer.createEvent(run, { eventId: "M-2", sequence: 2, eventType: "STOP_SKIPPED", logicalTime: 482, routeId: "R1", vehicleId: "V1", orderId: "O2", payload: { planRevision: 1 } }); const result = store.append(mismatch);
    check("T077", result.code === "EXECUTION_STOP_ROUTE_MISMATCH", result.code, "EXECUTION_STOP_ROUTE_MISMATCH");
  }
  {
    const f = fixture(); const gap = Reducer.createEvent(f.run, { eventId: "GAP", sequence: 2, eventType: "RUN_RELEASED", logicalTime: 481, payload: { planRevision: 1 } }); const gapResult = f.store.append(gap);
    check("T078", gapResult.code === "EXECUTION_SEQUENCE_GAP", gapResult.code, "EXECUTION_SEQUENCE_GAP");
    f.append("RUN_RELEASED"); const old = Reducer.createEvent(f.run, { eventId: "OLD", sequence: 1, eventType: "RUN_PAUSED", logicalTime: 482, payload: { planRevision: 1 } }); const oldResult = f.store.append(old);
    check("T079", oldResult.code === "EXECUTION_SEQUENCE_OUT_OF_ORDER", oldResult.code, "EXECUTION_SEQUENCE_OUT_OF_ORDER");
  }
  {
    const f = fixture(); f.append("RUN_RELEASED", { logicalTime: 500 }); const backward = Reducer.createEvent(f.run, { eventId: "BACKWARD", sequence: 2, eventType: "RUN_PAUSED", logicalTime: 499, payload: { planRevision: 1 } }); const result = f.store.append(backward);
    check("T080", result.code === "EXECUTION_LOGICAL_TIME_OUT_OF_ORDER", result.code, "EXECUTION_LOGICAL_TIME_OUT_OF_ORDER");
  }
  {
    const f = fixture(); const before = f.store.snapshot().executionStateHash; const accepted = f.append("RUN_RELEASED");
    check("T081", accepted.afterHash !== before && accepted.afterHash === f.store.snapshot().executionStateHash, { before, after: accepted.afterHash }, "different SHA-256 state hashes");
    const beforeReject = f.store.snapshot().executionStateHash; const rejected = f.append("RUN_COMPLETED");
    check("T082", rejected.status === "REJECTED" && rejected.afterHash === beforeReject && f.store.snapshot().executionStateHash === beforeReject, { status: rejected.status, beforeReject, after: rejected.afterHash }, { status: "REJECTED", hashUnchanged: true });
  }
  {
    const completed = terminateRoute(["complete", "skip"]); const completion = completed.append("RUN_COMPLETED"); const executionState = completed.store.snapshot();
    const capsule = Capsule.createCapsule({ execution: { run: completed.run, plan: completed.plan, acceptedEvents: executionState.acceptedEvents, executionState } }, { createdAt: "2026-08-31T12:00:00.000Z" }); const capsuleExecution = Capsule.extractSection(capsule, "execution").payload;
    check("T083", completion.status === "ACCEPTED" && capsuleExecution.executionState.run.terminalSummary && Object.values(capsuleExecution.executionState.run.terminalSummary).every((rows) => rows.length === 0), capsuleExecution.executionState.run.terminalSummary, "empty completion invariant sealed in Capsule");
    const review = ShiftReview.build({ executionState, alerts: { alerts: [], auditEvents: [] }, planActual: { routes: [], summary: {} }, reconciliation: {} });
    check("T084", review.reviewType === "FINAL_RUN" && review.completionInvariant && Object.values(review.completionInvariant).every((rows) => rows.length === 0), { reviewType: review.reviewType, completionInvariant: review.completionInvariant }, { reviewType: "FINAL_RUN", completionInvariant: "all empty" });
  }
  {
    const normal = fixture(); const noWebGL = fixture(["O1", "O2"], { noWebGL: true }); for (const target of [normal, noWebGL]) target.releaseDepart();
    check("T085", JSON.stringify(normal.store.snapshot().stopStates) === JSON.stringify(noWebGL.store.snapshot().stopStates) && noWebGL.store.snapshot().staleStatus === "LIVE_SIMULATION_NO_WEBGL", { normal: normal.store.snapshot().stopStates, noWebGL: noWebGL.store.snapshot().stopStates }, "same business state with explicit no-WebGL status");
    const fallback = fixture(["O1", "O2"], { mode: "FALLBACK" }); fallback.releaseDepart(); check("T086", JSON.stringify(normal.store.snapshot().routeCursors) === JSON.stringify(fallback.store.snapshot().routeCursors), fallback.store.snapshot().routeCursors, normal.store.snapshot().routeCursors);
  }
  check("T087", ["zh", "en", "ja"].every((locale) => Invariants.COPY[locale] && ["RUN_COMPLETION_INVARIANT_FAILED", "EXECUTION_STOP_NOT_ACTIONABLE", "EXECUTION_RUN_TERMINAL"].every((code) => Invariants.COPY[locale][code])), Object.keys(Invariants.COPY), ["zh", "en", "ja"]);

  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, assertions }, null, 2)}\n`);
}

main();
