#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Integrity = require("../integrity-hash-v151.js");
const Twin = require("../execution-twin-v16.js");
const Reducer = require("../execution-reducer-v17.js");
const Projection = require("../driver-local-projection-v17.js");
const Reconciliation = require("../driver-reconciliation-v17.js");

const assertions = [];
const isSha256 = (value) => /^sha256:[a-f0-9]{64}$/.test(String(value));
function check(requirementId, condition, observed, expected) {
  assert(condition, `${requirementId}: observed=${JSON.stringify(observed)} expected=${JSON.stringify(expected)}`);
  assertions.push({ assertionId: `${requirementId}-A1`, requirementId, status: "PASS", observed, expected, evidence: "tests/test_offline_projection_v17.js" });
}

function makePlan(routeSpecs = [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1", "O2"] }], suffix = "BASE") {
  const routes = routeSpecs.map((route, routeIndex) => ({
    ...route,
    geometry: route.geometry || route.orderIds.map((_, stopIndex) => [130.7 + routeIndex * 0.1 + stopIndex * 0.01, 32.8 + routeIndex * 0.1 + stopIndex * 0.01]),
  }));
  const plan = { schemaVersion: "stct-plan-v1.7-test", planId: `PLAN-${suffix}`, revision: 1, logicalStartMinute: 480, verification: { status: "PASS" }, routes };
  plan.planHash = Integrity.hashValue({ planId: plan.planId, routes });
  return plan;
}

function makeRun(plan, suffix = "BASE") {
  return Twin.createRun({ scenarioId: `SCENARIO-${suffix}`, inputHash: Integrity.hashValue({ input: suffix }), planHash: plan.planHash, routeGeometryHash: Integrity.hashValue(plan.routes.map((route) => route.geometry)), matrixHash: Integrity.hashValue({ matrix: suffix }), providerProvenance: { providerId: "SYNTHETIC_ROAD_FIXTURE" }, simulationSeed: "17", executionProfile: "ON_TIME", logicalStartMinute: 480, revision: 1 });
}

function appendAuthoritative(store, run, input) {
  const state = store.snapshot();
  const event = Reducer.createEvent(run, {
    eventId: input.eventId || `AUTH-${state.acceptedEvents.length + 1}-${input.eventType}`,
    sequence: state.acceptedEvents.length + 1,
    eventType: input.eventType,
    logicalTime: state.latestLogicalTime + 1,
    routeId: input.routeId || "",
    vehicleId: input.vehicleId || "",
    orderId: input.orderId || "",
    payload: { planRevision: 1, routeRevision: 1, ...(input.payload || {}) },
  });
  const result = store.append(event);
  assert.equal(result.status, "ACCEPTED", `${input.eventType} should seed authoritative state`);
  return result;
}

function fixture(options = {}) {
  const routeSpecs = options.routeSpecs || [{ routeId: "R1", vehicleId: "V1", orderIds: options.orderIds || ["O1", "O2"] }];
  const suffix = options.suffix || routeSpecs.map((route) => route.routeId).join("-");
  const plan = makePlan(routeSpecs, suffix); const run = makeRun(plan, suffix); const store = Reducer.createStore({ run, plan, noWebGL: options.noWebGL });
  appendAuthoritative(store, run, { eventType: "RUN_RELEASED" });
  for (const route of plan.routes) appendAuthoritative(store, run, { eventType: "ROUTE_ACCEPTED", routeId: route.routeId, vehicleId: route.vehicleId });
  for (const route of plan.routes) appendAuthoritative(store, run, { eventType: "VEHICLE_DEPARTED", routeId: route.routeId, vehicleId: route.vehicleId });
  const session = Reconciliation.createSession({ run, plan, store, storage: options.storage, storageKey: options.storageKey, maxItems: options.maxItems, noWebGL: options.noWebGL, clock: options.clock || (() => "2026-08-31T12:00:00.000Z") });
  return { plan, run, store, session };
}

function goOffline(f) { f.session.setOffline(); return f; }
function queueStop(session, eventType, orderId, fields = {}) { return session.queueEvent(eventType, { routeId: fields.routeId || "R1", vehicleId: fields.vehicleId || "V1", orderId, ...fields }); }
function queueCompletedStop(session, orderId, fields = {}) {
  queueStop(session, "STOP_ARRIVED", orderId, fields);
  queueStop(session, "SERVICE_STARTED", orderId, fields);
  return queueStop(session, "SERVICE_COMPLETED", orderId, fields);
}

async function main() {
  {
    const f = goOffline(fixture({ suffix: "REDUCER-REUSE" })); const before = f.store.snapshot(); const queued = queueStop(f.session, "STOP_ARRIVED", "O1");
    const direct = Reducer.reduce(before, f.plan, queued.item.event, { mode: "LOCAL_PROJECTION" });
    check("T071", Projection.reducerVersion === Reducer.VERSION && direct.state.executionStateHash === queued.projection.projectedExecutionStateHash, { projectionReducer: Projection.reducerVersion, executionReducer: Reducer.VERSION, stateHash: queued.projection.projectedExecutionStateHash }, "same reducer and state hash");
  }
  {
    const f = goOffline(fixture({ suffix: "SCHEMA" })); const initialHash = f.store.snapshot().executionStateHash; const first = queueStop(f.session, "STOP_ARRIVED", "O1"); const p = first.projection;
    check("T088", p.schemaVersion === "stct-local-driver-projection-v1.7" && ["baseExecutionStateHash", "baseSequence", "pendingEvents", "projectedRouteStates", "projectedStopStates", "projectedVehicleStates", "projectionHash", "conflicts"].every((key) => Object.hasOwn(p, key)), Object.keys(p), "LocalDriverProjection contract fields");
    check("T089", isSha256(p.projectionHash), p.projectionHash, "sha256: plus 64 lowercase hex");
    check("T090", p.baseExecutionStateHash === initialHash && p.baseSequence === f.store.snapshot().acceptedEvents.length, { baseHash: p.baseExecutionStateHash, baseSequence: p.baseSequence }, { baseHash: initialHash, baseSequence: f.store.snapshot().acceptedEvents.length });
    queueStop(f.session, "SERVICE_STARTED", "O1"); const complete = queueStop(f.session, "SERVICE_COMPLETED", "O1");
    check("T091", complete.projection.pendingEvents.map((item) => item.event.eventType).join(",") === "STOP_ARRIVED,SERVICE_STARTED,SERVICE_COMPLETED", complete.projection.pendingEvents.map((item) => item.event.eventType), ["STOP_ARRIVED", "SERVICE_STARTED", "SERVICE_COMPLETED"]);
    check("T092", first.projection.projectedStopStates.O1.state === "ARRIVED", first.projection.projectedStopStates.O1.state, "ARRIVED");
    check("T093", f.session.projection().projectedStopStates.O1.state === "COMPLETED", f.session.projection().projectedStopStates.O1.state, "Start accepted after Arrive, then completed");
    check("T094", complete.status === "LOCAL_PENDING" && complete.projection.projectedStopStates.O1.state === "COMPLETED", { status: complete.status, stop: complete.projection.projectedStopStates.O1.state }, { status: "LOCAL_PENDING", stop: "COMPLETED" });
    check("T097", complete.projection.conflicts.length === 0 && complete.projection.pendingEvents.length === 3, { conflicts: complete.projection.conflicts, count: complete.projection.pendingEvents.length }, { conflicts: [], count: 3 });
    check("T098", complete.projection.projectedRouteCursors.R1.nextActionableStopId === "O2" && complete.projection.projectedStopStates.O2.state === "EN_ROUTE", { cursor: complete.projection.projectedRouteCursors.R1, stop: complete.projection.projectedStopStates.O2 }, { nextActionableStopId: "O2", state: "EN_ROUTE" });
    check("T099", f.store.snapshot().stopStates.O1.state === "EN_ROUTE" && f.store.snapshot().executionStateHash === initialHash, { state: f.store.snapshot().stopStates.O1.state, hash: f.store.snapshot().executionStateHash }, { state: "EN_ROUTE", hash: initialHash });
    check("T100", f.session.legalActions("V1").source === "LOCAL_PROJECTION" && f.session.legalActions("V1").currentStopId === "O2", f.session.legalActions("V1"), { source: "LOCAL_PROJECTION", currentStopId: "O2" });
  }
  for (const [requirementId, eventType, terminal] of [["T095", "STOP_FAILED", "FAILED"], ["T096", "STOP_SKIPPED", "SKIPPED"]]) {
    const f = goOffline(fixture({ suffix: requirementId })); const result = queueStop(f.session, eventType, "O1");
    check(requirementId, result.status === "LOCAL_PENDING" && result.projection.projectedStopStates.O1.state === terminal, { status: result.status, stop: result.projection.projectedStopStates.O1.state }, { status: "LOCAL_PENDING", stop: terminal });
  }
  {
    const f = fixture({ suffix: "ONLINE-ACTIONS" });
    check("T101", f.session.legalActions("V1").source === "AUTHORITATIVE" && f.session.viewState().source === "AUTHORITATIVE", { legal: f.session.legalActions("V1").source, view: f.session.viewState().source }, { legal: "AUTHORITATIVE", view: "AUTHORITATIVE" });
    f.session.setOffline(); f.session.beginSync(); check("T102", f.session.snapshot().connectionState === "SYNCING", f.session.snapshot().connectionState, "SYNCING");
  }
  {
    const f = goOffline(fixture({ suffix: "ACK" })); queueStop(f.session, "STOP_ARRIVED", "O1"); const result = await f.session.reconcile();
    check("T103", f.store.snapshot().stopStates.O1.state === "ARRIVED" && result.status === "RECONCILED", { stop: f.store.snapshot().stopStates.O1.state, result: result.status }, { stop: "ARRIVED", result: "RECONCILED" });
    check("T104", result.projection.baseExecutionStateHash === f.store.snapshot().executionStateHash && result.projection.pendingEvents.length === 0, { base: result.projection.baseExecutionStateHash, authoritative: f.store.snapshot().executionStateHash, pending: result.projection.pendingEvents.length }, { baseEqualsAuthoritative: true, pending: 0 });
  }
  {
    const f = goOffline(fixture({ suffix: "MULTI-ACK" })); queueCompletedStop(f.session, "O1"); const result = await f.session.reconcile(); const audit = result.ackAudit;
    check("T105", audit.length === 3 && audit.every((row, index) => row.authoritativeSequence === index + 4), audit.map((row) => row.authoritativeSequence), [4, 5, 6]);
  }
  {
    const f = goOffline(fixture({ suffix: "PARTIAL-ACK" })); queueCompletedStop(f.session, "O1"); let calls = 0;
    const result = await f.session.reconcile(async () => { calls += 1; return calls === 1 ? { status: "ACK" } : { status: "RETRYABLE_FAILURE", errorCode: "NETWORK_INTERRUPTED" }; });
    check("T106", result.ackAudit.length === 1 && result.remaining.length === 2 && result.projection.baseSequence === 4, { ack: result.ackAudit.length, remaining: result.remaining.length, baseSequence: result.projection.baseSequence }, { ack: 1, remaining: 2, baseSequence: 4 });
  }
  {
    const f = goOffline(fixture({ suffix: "CONFLICT-CHAIN" })); const arrive = queueStop(f.session, "STOP_ARRIVED", "O1"); const start = queueStop(f.session, "SERVICE_STARTED", "O1");
    const result = await f.session.reconcile(async (event) => event.clientEventId === arrive.item.clientEventId ? { status: "CONFLICT", errorCode: "SERVER_STATE_CHANGED" } : { status: "ACK" });
    const first = result.remaining.find((item) => item.clientEventId === arrive.item.clientEventId); const second = result.remaining.find((item) => item.clientEventId === start.item.clientEventId);
    check("T107", first.status === "CONFLICT" && second.status === "BLOCKED_DEPENDENCY", { first: first.status, second: second.status }, { first: "CONFLICT", second: "BLOCKED_DEPENDENCY" });
    check("T108", second.dependsOn.includes(first.clientEventId) && second.dependencyChain.includes(first.clientEventId), { dependsOn: second.dependsOn, chain: second.dependencyChain }, first.clientEventId);
    const incident = f.session.createIncident(first.clientEventId, "Keep evidence"); check("T114", incident.schemaVersion === "stct-offline-conflict-incident-v1.7" && isSha256(incident.incidentHash) && incident.dependencyChain.length === 0, incident, "hashed incident evidence");
    const link = f.session.linkCounterRecovery(first.clientEventId, { counterRecoveryId: "CR-1", counterRecoveryHash: Integrity.hashValue({ recovery: 1 }) }); check("T142", link.clientEventId === first.clientEventId && isSha256(link.linkHash) && f.session.summary().recoveryLinkCount === 1, link, "Conflict linked to counter-recovery");
  }
  {
    const f = goOffline(fixture({ suffix: "PERMANENT" })); const item = queueStop(f.session, "STOP_ARRIVED", "O1").item; const result = await f.session.reconcile(async () => ({ status: "PERMANENT_FAILURE", errorCode: "INVALID_DRIVER" }));
    check("T109", result.remaining[0].clientEventId === item.clientEventId && result.remaining[0].status === "PERMANENT_FAILURE", result.remaining[0], { clientEventId: item.clientEventId, status: "PERMANENT_FAILURE" });
  }
  {
    const f = goOffline(fixture({ suffix: "RETRYABLE" })); const item = queueStop(f.session, "STOP_ARRIVED", "O1").item; const result = await f.session.reconcile(async () => ({ status: "RETRYABLE_FAILURE", errorCode: "NETWORK_TIMEOUT" }));
    check("T110", result.remaining[0].status === "RETRYABLE_FAILURE" && result.remaining[0].errorCode === "NETWORK_TIMEOUT", result.remaining[0], { status: "RETRYABLE_FAILURE", errorCode: "NETWORK_TIMEOUT" });
    const retried = f.session.manualRetry(item.clientEventId); check("T111", retried.status === "LOCAL_PENDING" && retried.errorCode === "", retried, { status: "LOCAL_PENDING", errorCode: "" });
  }
  {
    const f = goOffline(fixture({ suffix: "DISCARD" })); const first = queueStop(f.session, "STOP_ARRIVED", "O1").item; queueStop(f.session, "SERVICE_STARTED", "O1"); let guarded = false; try { f.session.discardLocalBranch(first.clientEventId, false); } catch (error) { guarded = error.code === "OFFLINE_DISCARD_CONFIRMATION_REQUIRED"; }
    const discarded = f.session.discardLocalBranch(first.clientEventId, true); check("T112", guarded && discarded.clientEventIds.length === 2 && f.session.list().length === 0, { guarded, discarded: discarded.clientEventIds }, { guarded: true, discardedCount: 2 });
  }
  {
    const f = goOffline(fixture({ suffix: "EDIT" })); const item = queueStop(f.session, "STOP_ARRIVED", "O1").item; await f.session.reconcile(async () => ({ status: "CONFLICT", errorCode: "REVISION_CHANGED" })); const edited = f.session.editAndRetry(item.clientEventId, { payload: { operatorNote: "confirmed" } });
    check("T113", edited.status === "LOCAL_PENDING" && edited.event.payload.operatorNote === "confirmed" && edited.idempotencyKey !== item.idempotencyKey, { status: edited.status, note: edited.event.payload.operatorNote, changedKey: edited.idempotencyKey !== item.idempotencyKey }, { status: "LOCAL_PENDING", note: "confirmed", changedKey: true });
  }
  {
    const f = goOffline(fixture({ suffix: "IDENTITY" })); const a = queueStop(f.session, "STOP_ARRIVED", "O1"); const b = queueStop(f.session, "SERVICE_STARTED", "O1");
    check("T115", a.item.clientEventId !== b.item.clientEventId, [a.item.clientEventId, b.item.clientEventId], "unique client event IDs");
    const duplicate = queueStop(f.session, "STOP_ARRIVED", "O1", { clientEventId: a.item.clientEventId });
    check("T116", duplicate.status === "DUPLICATE_IDEMPOTENT" && duplicate.item.idempotencyKey === a.item.idempotencyKey, { status: duplicate.status, first: a.item.idempotencyKey, repeated: duplicate.item.idempotencyKey }, "stable idempotency key");
    check("T117", b.item.localSequence === a.item.localSequence + 1 && f.session.summary().localSequenceReservation === b.item.localSequence, { sequences: [a.item.localSequence, b.item.localSequence], reservation: f.session.summary().localSequenceReservation }, "strictly monotonic reservation");
    check("T119", duplicate.item.event.eventHash === a.item.event.eventHash && f.session.list().length === 2, { first: a.item.event.eventHash, repeated: duplicate.item.event.eventHash, length: f.session.list().length }, { sameHash: true, length: 2 });
    const conflict = queueStop(f.session, "STOP_ARRIVED", "O1", { clientEventId: a.item.clientEventId, payload: { changed: true } }); check("T120", conflict.status === "CONFLICT" && conflict.item.errorCode === "CLIENT_EVENT_ID_PAYLOAD_CONFLICT", { status: conflict.status, code: conflict.item.errorCode }, { status: "CONFLICT", code: "CLIENT_EVENT_ID_PAYLOAD_CONFLICT" });
  }
  {
    const f = goOffline(fixture({ suffix: "MAPPING" })); queueStop(f.session, "STOP_ARRIVED", "O1", { localSequence: 20 }); const result = await f.session.reconcile(); const row = result.ackAudit[0];
    check("T118", row.authoritativeSequence === 4 && row.eventHash && row.authoritativeEventId, row, { localSequence: 20, authoritativeSequence: 4 });
  }
  for (const [requirementId, field, code] of [["T121", "planRevision", "EXECUTION_PLAN_REVISION_STALE"], ["T122", "routeRevision", "EXECUTION_ROUTE_REVISION_STALE"]]) {
    const f = goOffline(fixture({ suffix: requirementId })); const item = queueStop(f.session, "STOP_ARRIVED", "O1").item; f.session.editAndRetry(item.clientEventId, { payload: { [field]: 0 } }); const result = await f.session.reconcile(); const failed = result.remaining[0];
    check(requirementId, failed.status === "CONFLICT" && failed.errorCode === code, { status: failed.status, code: failed.errorCode }, { status: "CONFLICT", code });
  }
  {
    const storage = Reconciliation.memoryStorage(); const first = goOffline(fixture({ suffix: "REFRESH", storage, storageKey: "refresh" })); queueStop(first.session, "STOP_ARRIVED", "O1"); const authoritativeHash = first.store.snapshot().executionStateHash;
    const restored = Reconciliation.createSession({ run: first.run, plan: first.plan, store: first.store, storage, storageKey: "refresh" });
    check("T123", restored.projection().pendingEvents.length === 1 && restored.projection().projectedStopStates.O1.state === "ARRIVED", { pending: restored.projection().pendingEvents.length, stop: restored.projection().projectedStopStates.O1.state }, { pending: 1, stop: "ARRIVED" });
    const capsule = JSON.parse(JSON.stringify(restored.snapshot())); check("T129", capsule.summary.containsLocalPath === false && isSha256(capsule.projection.projectionHash), { containsLocalPath: capsule.summary.containsLocalPath, hash: capsule.projection.projectionHash }, { containsLocalPath: false, hash: "SHA-256" });
    const imported = Reconciliation.createSession({ run: first.run, plan: first.plan, store: first.store, storage, storageKey: "refresh" }); check("T130", first.store.snapshot().executionStateHash === authoritativeHash && imported.list().length === 1 && imported.snapshot().connectionState === "ONLINE", { hashUnchanged: first.store.snapshot().executionStateHash === authoritativeHash, queued: imported.list().length, connection: imported.snapshot().connectionState }, { hashUnchanged: true, queued: 1, connection: "ONLINE" });
  }
  {
    const storage = Reconciliation.memoryStorage(); storage.setItem("corrupt", "{not-json"); const f = fixture({ suffix: "CORRUPT", storage, storageKey: "corrupt" });
    check("T124", f.session.summary().corruption?.code === "OFFLINE_QUEUE_CORRUPT" && f.session.summary().corruption?.recoverable === true, f.session.summary().corruption, { code: "OFFLINE_QUEUE_CORRUPT", recoverable: true });
  }
  {
    const seed = fixture({ suffix: "MIGRATION-SEED" }); const state = seed.store.snapshot(); const event = Reducer.createEvent(seed.run, { eventId: "OLD-PENDING", sequence: state.acceptedEvents.length + 1, eventType: "STOP_ARRIVED", logicalTime: state.latestLogicalTime + 1, routeId: "R1", vehicleId: "V1", orderId: "O1", payload: { planRevision: 1, routeRevision: 1 } }); const storage = Reconciliation.memoryStorage(); storage.setItem("migration", JSON.stringify({ schemaVersion: "stct-offline-queue-v1.6", queue: [{ localEventId: "OLD-C1", event, status: "PENDING" }] }));
    const restored = Reconciliation.createSession({ run: seed.run, plan: seed.plan, store: seed.store, storage, storageKey: "migration" }); check("T125", restored.summary().migration?.from === "stct-offline-queue-v1.6" && restored.list()[0].status === "LOCAL_PENDING", { migration: restored.summary().migration, status: restored.list()[0].status }, { from: "stct-offline-queue-v1.6", status: "LOCAL_PENDING" });
  }
  {
    const f = goOffline(fixture({ suffix: "LIMIT", maxItems: 1 })); queueStop(f.session, "STOP_ARRIVED", "O1"); let code = ""; try { queueStop(f.session, "SERVICE_STARTED", "O1"); } catch (error) { code = error.code; } check("T126", code === "OFFLINE_QUEUE_SIZE_LIMIT", code, "OFFLINE_QUEUE_SIZE_LIMIT");
  }
  {
    const f = goOffline(fixture({ suffix: "CLEAR" })); queueStop(f.session, "STOP_ARRIVED", "O1"); let guarded = false; try { f.session.clear(false); } catch (error) { guarded = error.code === "OFFLINE_QUEUE_CLEAR_CONFIRMATION_REQUIRED"; } const cleared = f.session.clear(true); check("T127", guarded && cleared.removed === 1, { guarded, cleared }, { guarded: true, removed: 1 });
  }
  {
    const f = goOffline(fixture({ suffix: "AUDIT" })); queueStop(f.session, "STOP_ARRIVED", "O1"); await f.session.reconcile(); f.session.setOffline(); f.session.clear(true); check("T128", f.session.ackAudit().length === 1 && f.session.summary().ackAuditCount === 1, f.session.ackAudit(), "ACK audit retained after queue removal/clear");
  }
  {
    const storage = Reconciliation.memoryStorage(); const f = goOffline(fixture({ suffix: "FOCUS", storage, storageKey: "focus" })); f.session.setFocus({ type: "STOP", id: "O1" }); queueStop(f.session, "STOP_ARRIVED", "O1");
    check("T131", f.session.viewState().source === "LOCAL_PROJECTION" && f.session.snapshot().authoritativeStateHash !== f.session.projection().projectedExecutionStateHash, { source: f.session.viewState().source, authoritative: f.session.snapshot().authoritativeStateHash, projected: f.session.projection().projectedExecutionStateHash }, "explicit Local vs Authoritative state");
    check("T132", f.session.snapshot().connectionState === "OFFLINE" && f.session.viewState().source === "LOCAL_PROJECTION", { connectionState: f.session.snapshot().connectionState, source: f.session.viewState().source }, "textual state plus source, independent of color");
    check("T133", /1 pending local events/.test(f.session.summary().screenReaderSummary), f.session.summary().screenReaderSummary, "1 pending local events");
    f.session.beginSync(); const restored = Reconciliation.createSession({ run: f.run, plan: f.plan, store: f.store, storage, storageKey: "focus" }); check("T134", restored.getFocus().type === "STOP" && restored.getFocus().id === "O1", restored.getFocus(), { type: "STOP", id: "O1" });
  }
  {
    const orderIds = Array.from({ length: 7 }, (_, index) => `P20-${index + 1}`); const f = goOffline(fixture({ suffix: "PENDING-20", orderIds, maxItems: 20 })); const started = performance.now(); for (let index = 0; index < 6; index += 1) queueCompletedStop(f.session, orderIds[index]); queueStop(f.session, "STOP_ARRIVED", orderIds[6]); queueStop(f.session, "SERVICE_STARTED", orderIds[6]); const elapsed = performance.now() - started;
    check("T135", f.session.list().length === 20 && elapsed < 1000 && f.session.summary().degradation === "FULL_DETAIL", { pending: f.session.list().length, elapsedMs: Number(elapsed.toFixed(3)), degradation: f.session.summary().degradation }, { pending: 20, elapsedMs: "<1000", degradation: "FULL_DETAIL" });
  }
  {
    const orderIds = Array.from({ length: 34 }, (_, index) => `P100-${index + 1}`); const f = goOffline(fixture({ suffix: "PENDING-100", orderIds, maxItems: 100 })); for (let index = 0; index < 33; index += 1) queueCompletedStop(f.session, orderIds[index]); queueStop(f.session, "STOP_ARRIVED", orderIds[33]);
    check("T136", f.session.list().length === 100 && f.session.summary().degradation === "SUMMARY_ONLY_OVER_20", { pending: f.session.list().length, degradation: f.session.summary().degradation }, { pending: 100, degradation: "SUMMARY_ONLY_OVER_20" });
  }
  {
    const f = goOffline(fixture({ suffix: "BOUNDARY" })); const routesBefore = Object.keys(f.session.projection().projectedRouteStates); queueStop(f.session, "STOP_ARRIVED", "O1");
    check("T137", JSON.stringify(Object.keys(f.session.projection().projectedRouteStates)) === JSON.stringify(routesBefore), Object.keys(f.session.projection().projectedRouteStates), routesBefore);
    check("T138", f.session.summary().simulationBoundary === "LOCAL_SIMULATION_NOT_REAL_DRIVER_PLATFORM", f.session.summary().simulationBoundary, "LOCAL_SIMULATION_NOT_REAL_DRIVER_PLATFORM");
  }
  {
    const routes = [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1"] }, { routeId: "R2", vehicleId: "V2", orderIds: ["O2"] }]; const f = goOffline(fixture({ suffix: "MULTI-VEHICLE", routeSpecs: routes })); const v1 = queueStop(f.session, "STOP_ARRIVED", "O1", { routeId: "R1", vehicleId: "V1" }); const v2 = queueStop(f.session, "STOP_ARRIVED", "O2", { routeId: "R2", vehicleId: "V2" });
    check("T139", v2.projection.projectedStopStates.O1.state === "ARRIVED" && v2.projection.projectedStopStates.O2.state === "ARRIVED" && v1.item.dependsOn.length === 0 && v2.item.dependsOn.length === 0, { stops: v2.projection.projectedStopStates, dependencies: [v1.item.dependsOn, v2.item.dependsOn] }, "isolated vehicle projections");
  }
  {
    const routes = [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1"] }, { routeId: "R2", vehicleId: "V2", orderIds: ["O2"] }]; const f = goOffline(fixture({ suffix: "MULTI-CONFLICT", routeSpecs: routes })); const v1a = queueStop(f.session, "STOP_ARRIVED", "O1", { routeId: "R1", vehicleId: "V1" }).item; const v1b = queueStop(f.session, "SERVICE_STARTED", "O1", { routeId: "R1", vehicleId: "V1" }).item; const v2 = queueStop(f.session, "STOP_ARRIVED", "O2", { routeId: "R2", vehicleId: "V2" }).item;
    const result = await f.session.reconcile(async (event) => event.clientEventId === v1a.clientEventId ? { status: "CONFLICT", errorCode: "V1_CONFLICT" } : { status: "ACK" }); const rows = Object.fromEntries(result.results.map((row) => [row.clientEventId, row]));
    check("T140", rows[v1a.clientEventId].status === "CONFLICT" && rows[v1b.clientEventId].status === "BLOCKED_DEPENDENCY" && rows[v2.clientEventId].status === "ACKED" && f.store.snapshot().stopStates.O2.state === "ARRIVED", { v1a: rows[v1a.clientEventId].status, v1b: rows[v1b.clientEventId].status, v2: rows[v2.clientEventId].status, O2: f.store.snapshot().stopStates.O2.state }, { v1a: "CONFLICT", v1b: "BLOCKED_DEPENDENCY", v2: "ACKED", O2: "ARRIVED" });
    check("T141", f.session.summary().unresolvedConflicts === 2, f.session.summary(), { unresolvedConflicts: 2 });
  }
  {
    const f = goOffline(fixture({ suffix: "E2E" })); queueCompletedStop(f.session, "O1"); const offline = f.session.projection(); const reconciled = await f.session.reconcile();
    check("T143", offline.projectedStopStates.O1.state === "COMPLETED" && reconciled.status === "RECONCILED" && f.store.snapshot().stopStates.O1.state === "COMPLETED" && f.session.list().length === 0 && f.session.snapshot().connectionState === "ONLINE", { offline: offline.projectedStopStates.O1.state, reconciled: reconciled.status, authoritative: f.store.snapshot().stopStates.O1.state, queue: f.session.list().length, connection: f.session.snapshot().connectionState }, { offline: "COMPLETED", reconciled: "RECONCILED", authoritative: "COMPLETED", queue: 0, connection: "ONLINE" });
  }

  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, assertions }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
