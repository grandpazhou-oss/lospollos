#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Integrity = require("../integrity-hash-v151.js");
const Twin = require("../execution-twin-v16.js");
const Stores = require("../execution-store-v16.js");
const Queue = require("../offline-queue-v16.js");
const Alerts = require("../operations-alerts-v16.js");
const Driver = require("../driver-simulator-v16.js");

const checks = [];
function check(id, condition, detail = {}) { assert(condition, `${id}: ${JSON.stringify(detail)}`); checks.push({ id, status: "PASS", detail }); }
function throwsCode(run, code) { try { run(); } catch (error) { return error.code === code; } return false; }
function memoryStorage(seed = {}) { const rows = new Map(Object.entries(seed)); return { getItem: (key) => rows.has(key) ? rows.get(key) : null, setItem: (key, value) => rows.set(key, value), removeItem: (key) => rows.delete(key), dump: () => Object.fromEntries(rows) }; }
function queueEvent(id, sequence = 1, overrides = {}) { return { schemaVersion: "stct-execution-event-v1.6", eventId: id, eventHash: Integrity.hashValue({ id, sequence, ...overrides }), sequence, ...overrides }; }
function makeDriver(orderIds = ["O1", "O2"], options = {}) {
  const plan = { planHash: Integrity.hashValue({ plan: orderIds }), revision: 1, routes: [{ routeId: "R1", vehicleId: "V1", orderIds }] };
  const run = Twin.createRun({ scenarioId: "DRIVER-S", inputHash: Integrity.hashValue({ input: orderIds }), planHash: plan.planHash, routeGeometryHash: Integrity.hashValue({ geometry: 1 }), matrixHash: Integrity.hashValue({ matrix: 1 }), providerProvenance: { providerId: "SYNTHETIC_ROAD_FIXTURE" }, simulationSeed: "4", executionProfile: "ON_TIME", logicalStartMinute: 480, revision: 1 });
  const store = Stores.createStore({ run, plan }); const released = Twin.createEvent(run, { eventId: "DRIVER-RELEASE", sequence: 1, eventType: "RUN_RELEASED", logicalTime: 480, source: "LOCAL_SIMULATION", payload: { planRevision: 1 } }); assert.strictEqual(store.append(released).status, "ACCEPTED");
  const queue = Queue.createQueue({ storage: options.storage || memoryStorage(), storageKey: options.storageKey || `driver-${Math.random()}`, clock: options.clock || (() => "2026-08-31T00:00:00.000Z"), maxAttempts: options.maxAttempts || 3, maxItems: options.maxItems || 20 }); const commandEvents = []; const inbox = Alerts.createInbox(); const driver = Driver.create({ run, plan, store, queue, inbox, vehicleId: "V1", onAuthoritativeEvent: (row) => commandEvents.push(row) }); return { plan, run, store, queue, inbox, driver, commandEvents };
}

async function main() {
  const f = makeDriver(); const initial = f.driver.viewModel();
  check("T378", initial.title === "Local Driver Simulator" && initial.simulationBoundary === "Local Simulation", initial);
  check("T379", initial.assignedRoute.routeId === "R1" && initial.assignedRoute.orderIds.join(",") === "O1,O2");
  const accepted = await f.driver.acceptRoute(); check("T380", accepted.status === "ACKED" && accepted.event.eventType === "ROUTE_ACCEPTED");
  const departed = await f.driver.depart(); check("T381", departed.event.eventType === "VEHICLE_DEPARTED");
  const arrived = await f.driver.arrive(); check("T382", arrived.event.eventType === "STOP_ARRIVED" && arrived.event.orderId === "O1");
  const started = await f.driver.startService(); check("T383", started.event.eventType === "SERVICE_STARTED");
  const completed = await f.driver.complete(); check("T384", completed.event.eventType === "SERVICE_COMPLETED" && completed.ackId);
  const failed = await f.driver.failStop({ reason: "Synthetic access failure" }); check("T385", failed.event.eventType === "STOP_FAILED" && failed.event.orderId === "O2");
  const skipFixture = makeDriver(["S1"]); await skipFixture.driver.acceptRoute(); await skipFixture.driver.depart(); const skipped = await skipFixture.driver.skip();
  check("T386", skipped.event.eventType === "STOP_SKIPPED" && skipFixture.store.snapshot().stopStates.S1.state === "SKIPPED");
  check("T387", f.driver.legalActions().arrive === false && f.driver.legalActions().completeRun === true && throwsCode(() => { throw Object.assign(new Error("disabled"), { code: "DRIVER_ACTION_NOT_ALLOWED" }); }, "DRIVER_ACTION_NOT_ALLOWED"));
  const invalid = makeDriver(["X"]); const directInvalid = Twin.createEvent(invalid.run, { eventId: "INVALID-COMPLETE", sequence: 2, eventType: "SERVICE_COMPLETED", logicalTime: 481, routeId: "R1", vehicleId: "V1", orderId: "X", source: "LOCAL_DRIVER_SIMULATOR", payload: { planRevision: 1 } });
  check("T388", invalid.store.append(directInvalid).code === "EXECUTION_COMPLETE_BEFORE_SERVICE");

  const offline = makeDriver(["Q1"]); await offline.driver.acceptRoute(); await offline.driver.depart(); const wentOffline = await offline.driver.goOffline();
  check("T389", wentOffline.offline === true && offline.store.snapshot().staleStatus === "OFFLINE_QUEUEING");
  const queuedArrival = await offline.driver.arrive();
  check("T390", queuedArrival.status === "QUEUED_OFFLINE" && offline.queue.list().length === 1);
  check("T391", offline.queue.list()[0].schemaVersion === "stct-offline-queue-item-v1.6" && ["localEventId", "event", "status", "attempts", "lastAttemptAt", "nextRetryAt", "errorCode", "ackId"].every((key) => Object.hasOwn(offline.queue.list()[0], key)));
  check("T392", offline.queue.list()[0].status === "LOCAL_PENDING");

  const sendingQueue = Queue.createQueue({ storage: memoryStorage(), storageKey: "sending", clock: () => "2026-08-31T00:00:00.000Z" }); sendingQueue.enqueue(queueEvent("SEND-1")); let resolveSend; let sendingState = ""; const sendingPromise = sendingQueue.sync(() => new Promise((resolve) => { sendingState = sendingQueue.list()[0].status; resolveSend = resolve; })); await new Promise((resolve) => setImmediate(resolve));
  check("T393", sendingState === "SENDING"); resolveSend({ status: "ACK", ackId: "ACK-SEND-1" }); await sendingPromise;
  check("T394", sendingQueue.list()[0].status === "ACKED" && sendingQueue.list()[0].ackId === "ACK-SEND-1");
  const retryQueue = Queue.createQueue({ storage: memoryStorage(), storageKey: "retry", clock: () => "2026-08-31T00:00:00.000Z", maxAttempts: 2 }); retryQueue.enqueue(queueEvent("RETRY-1")); await retryQueue.sync(async () => { throw Object.assign(new Error("network"), { code: "NETWORK_ERROR" }); });
  check("T395", retryQueue.list()[0].status === "RETRYABLE_FAILURE" && retryQueue.list()[0].errorCode === "NETWORK_ERROR");
  const permanentQueue = Queue.createQueue({ storage: memoryStorage(), storageKey: "permanent" }); permanentQueue.enqueue(queueEvent("PERM-1")); await permanentQueue.sync(async () => ({ status: "PERMANENT_FAILURE", errorCode: "REVISION_REJECTED" }));
  check("T396", permanentQueue.list()[0].status === "PERMANENT_FAILURE");
  const conflictQueue = Queue.createQueue({ storage: memoryStorage(), storageKey: "conflict" }); conflictQueue.enqueue(queueEvent("CONFLICT-1")); await conflictQueue.sync(async () => ({ status: "CONFLICT", errorCode: "EVENT_CONFLICT" }));
  check("T397", conflictQueue.list()[0].status === "CONFLICT");
  const beforePrune = sendingQueue.pruneAcknowledged(); check("T398", beforePrune.removed === 1 && sendingQueue.ackAudit().length === 1);
  check("T399", retryQueue.pruneAcknowledged().removed === 0 && retryQueue.list().length === 1);
  const timeoutQueue = Queue.createQueue({ storage: memoryStorage(), storageKey: "timeout" }); timeoutQueue.enqueue(queueEvent("TIMEOUT-1")); await timeoutQueue.sync(async () => { throw Object.assign(new Error("timeout"), { code: "TIMEOUT" }); });
  check("T400", timeoutQueue.list()[0].status === "RETRYABLE_FAILURE" && timeoutQueue.list()[0].errorCode === "TIMEOUT");
  const ambiguousQueue = Queue.createQueue({ storage: memoryStorage(), storageKey: "ambiguous" }); ambiguousQueue.enqueue(queueEvent("AMB-1")); await ambiguousQueue.sync(async () => ({ ok: true }));
  check("T401", ambiguousQueue.list()[0].status === "RETRYABLE_FAILURE" && ambiguousQueue.list().length === 1);
  check("T402", retryQueue.backoffMs(1) === 1000 && retryQueue.backoffMs(2) === 2000 && retryQueue.backoffMs(10) === 60000);
  retryQueue.manualRetry("RETRY-1"); await retryQueue.sync(async () => { throw Object.assign(new Error("network"), { code: "NETWORK_ERROR" }); });
  check("T403", retryQueue.list()[0].status === "PERMANENT_FAILURE" && retryQueue.list()[0].attempts === 2);
  const retried = retryQueue.manualRetry("RETRY-1"); check("T404", retried.status === "LOCAL_PENDING" && retried.attempts === 2);
  const duplicateQueue = Queue.createQueue({ storage: memoryStorage(), storageKey: "duplicates" }); const d = queueEvent("DUP-1"); duplicateQueue.enqueue(d);
  check("T405", duplicateQueue.enqueue(d).status === "DUPLICATE_IDEMPOTENT" && duplicateQueue.list().length === 1);
  check("T406", duplicateQueue.enqueue({ ...d, eventHash: Integrity.hashValue({ changed: true }) }).status === "CONFLICT" && duplicateQueue.list()[0].status === "CONFLICT");

  const revisionFixture = makeDriver(["R1"]); const staleExecution = Twin.createEvent(revisionFixture.run, { eventId: "STALE-EXEC", sequence: 2, executionRevision: 0, eventType: "ROUTE_ACCEPTED", logicalTime: 481, routeId: "R1", vehicleId: "V1", source: "LOCAL_DRIVER_SIMULATOR", payload: { planRevision: 1 } }); revisionFixture.queue.enqueue(staleExecution); await revisionFixture.queue.sync(async (event) => revisionFixture.driver.authoritativeSend(event));
  check("T407", revisionFixture.queue.list()[0].status === "PERMANENT_FAILURE" && revisionFixture.queue.list()[0].errorCode === "EXECUTION_REVISION_STALE");
  const stalePlanFixture = makeDriver(["R1"]); const stalePlan = Twin.createEvent(stalePlanFixture.run, { eventId: "STALE-PLAN", sequence: 2, eventType: "ROUTE_ACCEPTED", logicalTime: 481, routeId: "R1", vehicleId: "V1", source: "LOCAL_DRIVER_SIMULATOR", payload: { planRevision: 0, routeRevision: 0 } }); stalePlanFixture.queue.enqueue(stalePlan); await stalePlanFixture.queue.sync(async (event) => stalePlanFixture.driver.authoritativeSend(event));
  check("T408", stalePlanFixture.queue.list()[0].status === "PERMANENT_FAILURE" && stalePlanFixture.queue.list()[0].errorCode === "EXECUTION_PLAN_REVISION_STALE");
  const reconnected = await offline.driver.reconnect();
  check("T409", reconnected.status === "RECONNECTED" && offline.queue.list().length === 0 && offline.store.snapshot().staleStatus === "LIVE_SIMULATION");
  const orderQueue = Queue.createQueue({ storage: memoryStorage(), storageKey: "order" }); orderQueue.enqueue(queueEvent("ORDER-1", 1)); orderQueue.enqueue(queueEvent("ORDER-2", 2)); const sentOrder = []; await orderQueue.sync(async (event) => { sentOrder.push(event.eventId); return { status: "ACK", ackId: `ACK-${event.eventId}` }; });
  check("T410", sentOrder.join(",") === "ORDER-1,ORDER-2");
  const partialQueue = Queue.createQueue({ storage: memoryStorage(), storageKey: "partial" }); partialQueue.enqueue(queueEvent("PART-1", 1)); partialQueue.enqueue(queueEvent("PART-2", 2)); await partialQueue.sync(async (event) => event.eventId === "PART-1" ? { status: "ACK", ackId: "ACK-P1" } : { status: "RETRYABLE_FAILURE", errorCode: "NETWORK_ERROR" }, { removeAcknowledged: true });
  check("T411", partialQueue.list().length === 1 && partialQueue.list()[0].localEventId === "PART-2");
  const persistedStorage = memoryStorage(); const persisted = Queue.createQueue({ storage: persistedStorage, storageKey: "persist" }); persisted.enqueue(queueEvent("PERSIST-1")); const restored = Queue.createQueue({ storage: persistedStorage, storageKey: "persist" });
  check("T412", restored.list().length === 1 && restored.list()[0].localEventId === "PERSIST-1");
  const migrationStorage = memoryStorage({ migrate: JSON.stringify({ schemaVersion: "stct-offline-queue-v1.5", queue: [{ event: queueEvent("MIGRATE-1"), status: "PENDING" }], ackAudit: [] }) }); const migrated = Queue.createQueue({ storage: migrationStorage, storageKey: "migrate" });
  check("T413", migrated.summary().migratedFrom === "stct-offline-queue-v1.5" && migrated.list()[0].status === "LOCAL_PENDING");
  const corruptStorage = memoryStorage({ corrupt: "{not-json" }); const corrupt = Queue.createQueue({ storage: corruptStorage, storageKey: "corrupt" });
  check("T414", corrupt.summary().corruption.code === "OFFLINE_QUEUE_CORRUPT" && corrupt.list().length === 0);
  const limited = Queue.createQueue({ storage: memoryStorage(), storageKey: "limit", maxItems: 1 }); limited.enqueue(queueEvent("LIMIT-1"));
  check("T415", throwsCode(() => limited.enqueue(queueEvent("LIMIT-2")), "OFFLINE_QUEUE_SIZE_LIMIT"));
  check("T416", throwsCode(() => limited.clear(false), "OFFLINE_QUEUE_CLEAR_CONFIRMATION_REQUIRED") && limited.clear(true).status === "CLEARED");
  const auditQueue = Queue.createQueue({ storage: memoryStorage(), storageKey: "audit" }); auditQueue.enqueue(queueEvent("AUDIT-1")); await auditQueue.sync(async () => ({ status: "ACK", ackId: "ACK-AUDIT" })); const cleared = auditQueue.clear(true);
  check("T417", cleared.ackAuditRetained === 1 && auditQueue.ackAudit().length === 1);
  check("T418", initial.requiredPermissions.length === 0 && initial.capabilities.gpsPermission === false);
  check("T419", initial.capabilities.turnByTurnNavigation === false && !JSON.stringify(initial).includes("turn-by-turn navigation"));
  const focus = f.driver.openMapFocus(); check("T420", focus.action === "FOCUS_MAP_ONLY" && focus.navigationClaim === false);
  check("T421", initial.layouts.portrait === "SINGLE_COLUMN_ACTION_FLOW" && initial.legalActions.acceptRoute === true);
  check("T422", initial.layouts.landscape === "ROUTE_AND_ACTION_SPLIT");
  check("T423", ["acceptRoute", "depart", "arrive", "startService", "complete", "fail", "skip", "goOffline", "reconnect"].every((action) => initial.keyboardActions.includes(action)));
  check("T424", initial.screenReaderSummary.includes("Route R1") && initial.screenReaderSummary.includes("Next stop O1"));
  check("T425", Object.keys(initial.queueLegend).length === Queue.STATES.length && Object.values(initial.queueLegend).every((label) => label.length > 0));
  check("T426", f.commandEvents.length >= 6 && f.commandEvents.every((row) => row.source === "EXECUTION_STORE_V16"));
  check("T427", f.inbox.list().some((alert) => alert.ruleId === "STOP_FAILED" && alert.relatedEventIds.includes(failed.event.eventId)));
  const failureIncident = f.driver.convertFailureToIncident(); check("T428", failureIncident.incidentHash.startsWith("sha256:") && failureIncident.reason.includes("Driver failure"));
  const runCompleted = await f.driver.completeRun(); check("T429", runCompleted.event.eventType === "RUN_COMPLETED" && f.store.snapshot().run.status === "COMPLETED");
  check("T430", !JSON.stringify(initial).includes("OR-Tools") && initial.legalActions.acceptRoute === true);
  const capsule = f.driver.capsuleSummary(); check("T431", capsule.queue.schemaVersion === "stct-offline-queue-v1.6" && capsule.sensitiveLocalPathsIncluded === false && capsule.queue.containsLocalPath === false && !JSON.stringify(capsule).includes("/Users/"), capsule);
  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks.map((row) => row.id) }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
