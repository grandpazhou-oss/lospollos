#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Integrity = require("../integrity-hash-v151.js");
const Providers = require("../routing-provider-registry-v16.js");
const Fixture = require("../road-network-fixture-v16.js");
const Twin = require("../execution-twin-v16.js");
const Stores = require("../execution-store-v16.js");
const Profiles = require("../execution-profiles-v16.js");

const checks = [];
function check(id, condition, detail = {}) { assert(condition, `${id}: ${JSON.stringify(detail)}`); checks.push({ id, status: "PASS", detail }); }
function throwsCode(run, code) { try { run(); } catch (error) { return error.code === code; } return false; }

async function fixture() {
  const graph = Fixture.createFixture(); const nodes = new Map(graph.nodes.map((node) => [node.nodeId, node])); const provider = Providers.createRegistry().get("SYNTHETIC_ROAD_FIXTURE");
  const points = ["DEPOT", "B", "C"].map((nodeId, index) => ({ pointId: index ? `O${index}` : "DEPOT", lon: nodes.get(nodeId).lon, lat: nodes.get(nodeId).lat }));
  const request = { schemaVersion: "stct-routing-request-v1.6", providerId: provider.id, profile: "light-truck", points, distanceUnit: "km", durationUnit: "minutes", snapToleranceMeters: 120 };
  const route = await provider.route(request); const matrix = await provider.matrix(request);
  const plan = { schemaVersion: "stct-plan-v1.6-test", planId: "EXEC-PLAN", planHash: Integrity.hashValue({ plan: "EXEC-PLAN" }), revision: 1, routes: [{ routeId: "R1", vehicleId: "V1", orderIds: ["O1", "O2"], geometry: route.geometry, edgeIds: route.edgeIds, totalDistance: route.totalDistance, estimated: false }] };
  const runInput = { scenarioId: "EXEC-SCENARIO", inputHash: Integrity.hashValue({ scenario: "EXEC-SCENARIO" }), planHash: plan.planHash, routeGeometryHash: route.routeHash, matrixHash: matrix.matrixHash, providerProvenance: route.providerProvenance, simulationSeed: "42", executionProfile: "ON_TIME", logicalStartMinute: 480, revision: 1 };
  return { graph, nodes, provider, request, route, matrix, plan, runInput, run: Twin.createRun(runInput) };
}

function event(run, sequence, eventType, fields = {}) { return Twin.createEvent(run, { eventId: fields.eventId || `E-${sequence}-${eventType}`, sequence, eventType, logicalTime: fields.logicalTime ?? 480 + sequence, routeId: fields.routeId ?? (eventType === "RUN_RELEASED" || eventType === "RUN_COMPLETED" || eventType.startsWith("NETWORK_") ? "" : "R1"), vehicleId: fields.vehicleId ?? (eventType === "RUN_RELEASED" || eventType === "RUN_COMPLETED" || eventType.startsWith("NETWORK_") ? "" : "V1"), orderId: fields.orderId || "", coordinate: fields.coordinate, roadEdgeId: fields.roadEdgeId, ackId: fields.ackId, payload: { planRevision: run.revision, ...(fields.payload || {}) } }); }

async function main() {
  const f = await fixture(); const run = f.run;
  check("T200", run.schemaVersion === "stct-execution-run-v1.6" && Twin.RUN_STATUSES.includes(run.status) && run.executionRunId.startsWith("RUN-"), run);
  check("T201", run.executionRunHash.startsWith("sha256:") && run.executionRunHash === Integrity.hashValue(Twin.runIdentity(run)));
  check("T202", Twin.createRun(f.runInput).executionRunHash === run.executionRunHash);
  check("T203", Twin.createRun({ ...f.runInput, simulationSeed: "43" }).executionRunHash !== run.executionRunHash);
  check("T204", Twin.createRun({ ...f.runInput, planHash: Integrity.hashValue({ plan: "OTHER" }) }).executionRunHash !== run.executionRunHash);
  check("T205", Twin.createRun({ ...f.runInput, matrixHash: Integrity.hashValue({ matrix: "OTHER" }) }).executionRunHash !== run.executionRunHash);
  const firstEvent = event(run, 1, "RUN_RELEASED");
  check("T206", firstEvent.schemaVersion === "stct-execution-event-v1.6" && Twin.EVENT_TYPES.includes(firstEvent.eventType), firstEvent);
  check("T207", firstEvent.eventHash.startsWith("sha256:") && firstEvent.eventHash === Integrity.hashValue(Twin.eventIdentity(firstEvent)));

  const store = Stores.createStore({ run, plan: f.plan, clock: () => "2026-08-31T00:00:00.000Z", staleAfterMinutes: 10 }); let sequence = 0; let logical = 480;
  const append = (type, fields = {}) => { sequence += 1; logical = Math.max(logical, fields.logicalTime ?? logical + 1); return store.append(event(run, sequence, type, { ...fields, logicalTime: logical })); };
  const released = append("RUN_RELEASED");
  check("T208", released.status === "ACCEPTED" && store.snapshot().acceptedEvents.every((row, index) => row.sequence === index + 1));
  check("T209", store.append(released.event).status === "DUPLICATE_IDEMPOTENT");
  const conflict = { ...released.event, payload: { ...released.event.payload, changed: true } };
  check("T210", store.append(conflict).code === "EXECUTION_EVENT_ID_CONFLICT");
  const staleRevision = event(run, 2, "ROUTE_ACCEPTED", { payload: { planRevision: run.revision }, routeId: "R1" }); staleRevision.executionRevision = 0; staleRevision.eventHash = Integrity.hashValue(Twin.eventIdentity(staleRevision));
  check("T211", store.append(staleRevision).code === "EXECUTION_REVISION_STALE");
  const stalePlan = event(run, 2, "ROUTE_ACCEPTED", { payload: { planRevision: 0 } });
  check("T212", store.append(stalePlan).code === "EXECUTION_PLAN_REVISION_STALE");
  check("T213", released.status === "ACCEPTED");
  check("T214", append("ROUTE_ACCEPTED").status === "ACCEPTED");
  check("T215", append("VEHICLE_DEPARTED").status === "ACCEPTED");
  check("T216", append("POSITION_RECORDED", { coordinate: f.route.geometry[1], roadEdgeId: f.route.edgeIds[0] }).status === "ACCEPTED");
  check("T217", append("STOP_ARRIVED", { orderId: "O1" }).status === "ACCEPTED");
  check("T218", append("SERVICE_STARTED", { orderId: "O1" }).status === "ACCEPTED");
  const completed = append("SERVICE_COMPLETED", { orderId: "O1", ackId: "ACK-O1" });
  check("T219", completed.status === "ACCEPTED" && store.snapshot().stopStates.O1.state === "COMPLETED");
  check("T220", append("STOP_FAILED", { orderId: "O2" }).status === "ACCEPTED" && store.snapshot().stopStates.O2.state === "FAILED");

  const branchStore = Stores.createStore({ run, plan: f.plan }); let branchSequence = 0; let branchTime = 480; const branch = (type, fields = {}) => { branchSequence += 1; branchTime += 1; return branchStore.append(event(run, branchSequence, type, { logicalTime: branchTime, ...fields })); };
  branch("RUN_RELEASED"); branch("ROUTE_ACCEPTED"); branch("VEHICLE_DEPARTED");
  check("T221", branch("STOP_SKIPPED", { orderId: "O1" }).status === "ACCEPTED");
  check("T222", branch("UNPLANNED_STOP", { coordinate: f.route.geometry[1] }).status === "ACCEPTED");
  check("T223", branch("OFF_ROUTE_DETECTED", { coordinate: f.route.geometry[1] }).status === "ACCEPTED" && branchStore.snapshot().vehicleStates.V1.offRoute);
  check("T224", branch("ROUTE_REJOINED", { coordinate: f.route.geometry[1] }).status === "ACCEPTED" && !branchStore.snapshot().vehicleStates.V1.offRoute);
  check("T225", branch("VEHICLE_BREAKDOWN", { orderId: "O2" }).status === "ACCEPTED" && !branchStore.snapshot().vehicleStates.V1.available);

  const cancelStore = Stores.createStore({ run, plan: f.plan }); cancelStore.append(event(run, 1, "RUN_RELEASED"));
  check("T226", cancelStore.append(event(run, 2, "ORDER_CANCELLED", { orderId: "O1" })).status === "ACCEPTED");
  check("T227", append("NETWORK_OFFLINE").status === "ACCEPTED" && store.snapshot().staleStatus === "OFFLINE_QUEUEING");
  check("T228", append("NETWORK_RESTORED").status === "ACCEPTED" && store.snapshot().staleStatus === "LIVE_SIMULATION");
  check("T229", append("RUN_COMPLETED").status === "ACCEPTED" && store.snapshot().run.status === "COMPLETED");

  const invalidRouteStore = Stores.createStore({ run, plan: f.plan });
  check("T230", invalidRouteStore.append(event(run, 1, "ROUTE_ACCEPTED")).code === "EXECUTION_ROUTE_TRANSITION_INVALID");
  const invalidStopStore = Stores.createStore({ run, plan: f.plan }); invalidStopStore.append(event(run, 1, "RUN_RELEASED")); invalidStopStore.append(event(run, 2, "ROUTE_ACCEPTED")); invalidStopStore.append(event(run, 3, "VEHICLE_DEPARTED"));
  check("T231", invalidStopStore.append(event(run, 4, "SERVICE_COMPLETED", { orderId: "O1" })).code === "EXECUTION_COMPLETE_BEFORE_SERVICE");
  check("T232", invalidStopStore.append(event(run, 4, "SERVICE_COMPLETED", { eventId: "COMPLETE-BEFORE-ARRIVE", orderId: "O1" })).code === "EXECUTION_COMPLETE_BEFORE_SERVICE");
  check("T233", invalidStopStore.append(event(run, 4, "SERVICE_STARTED", { orderId: "O1" })).code === "EXECUTION_SERVICE_START_BEFORE_ARRIVAL");
  const duplicateCompleteStore = Stores.createStore({ run, plan: f.plan }); [event(run, 1, "RUN_RELEASED"), event(run, 2, "ROUTE_ACCEPTED"), event(run, 3, "VEHICLE_DEPARTED"), event(run, 4, "STOP_ARRIVED", { orderId: "O1" }), event(run, 5, "SERVICE_STARTED", { orderId: "O1" })].forEach((row) => duplicateCompleteStore.append(row)); const completion = event(run, 6, "SERVICE_COMPLETED", { orderId: "O1" }); duplicateCompleteStore.append(completion);
  check("T234", duplicateCompleteStore.append(completion).status === "DUPLICATE_IDEMPOTENT" && duplicateCompleteStore.append(event(run, 7, "SERVICE_COMPLETED", { eventId: "SECOND-COMPLETE", orderId: "O1" })).code === "EXECUTION_COMPLETE_BEFORE_SERVICE");
  check("T235", store.authority === "EXECUTION_STORE_V16" && store.snapshot().authority === "EXECUTION_STORE_V16");
  const exported = store.exportState(); const rebuilt = Stores.rebuild(exported, { clock: () => "2026-08-31T00:00:00.000Z" });
  check("T236", JSON.stringify(rebuilt.snapshot().routeStates) === JSON.stringify(store.snapshot().routeStates) && JSON.stringify(rebuilt.snapshot().stopStates) === JSON.stringify(store.snapshot().stopStates));
  check("T237", rebuilt.snapshot().executionStateHash === store.snapshot().executionStateHash, { rebuilt: rebuilt.snapshot().executionStateHash, source: store.snapshot().executionStateHash });
  const outOfOrderStore = Stores.createStore({ run, plan: f.plan }); const outOfOrder = outOfOrderStore.append(event(run, 2, "RUN_RELEASED"));
  check("T238", outOfOrder.code === "EXECUTION_SEQUENCE_GAP");
  check("T239", outOfOrderStore.snapshot().staleStatus === "PARTIAL_EVENTS");
  const staleStore = Stores.createStore({ run, plan: f.plan, staleAfterMinutes: 5 }); staleStore.append(event(run, 1, "RUN_RELEASED")); const beforeStale = staleStore.snapshot().lastKnownGood; staleStore.markStale(490);
  check("T240", staleStore.snapshot().staleStatus === "STALE");
  check("T241", staleStore.snapshot().lastKnownGood.executionStateHash === beforeStale.executionStateHash && staleStore.snapshot().routeStates.R1.state === "RELEASED", staleStore.snapshot().lastKnownGood);

  const profileTestIds = ["T242", "T243", "T244", "T245", "T246", "T247", "T248"];
  for (const [index, profile] of Twin.PROFILES.entries()) {
    const profileRun = Twin.createRun({ ...f.runInput, executionProfile: profile }); const left = Profiles.generate(profileRun, f.plan); const right = Profiles.generate(profileRun, f.plan); check(profileTestIds[index], left.eventStreamHash === right.eventStreamHash && JSON.stringify(left.events) === JSON.stringify(right.events), { profile, eventStreamHash: left.eventStreamHash });
  }
  const onTimeStream = Profiles.generate(run, f.plan); const position = onTimeStream.events.find((row) => row.eventType === "POSITION_RECORDED");
  check("T249", position.payload.geometrySource === "ROAD_ROUTE_RESULT" && f.route.geometry.some((point) => Math.abs(point[0] - position.coordinate[0]) < 0.02 && Math.abs(point[1] - position.coordinate[1]) < 0.02), position);
  const estimatedPlan = structuredClone(f.plan); estimatedPlan.routes[0].estimated = true; const estimatedStream = Profiles.generate(run, estimatedPlan);
  check("T250", estimatedStream.events.find((row) => row.eventType === "POSITION_RECORDED").payload.geometrySource === "ESTIMATED_GEOMETRY" && estimatedStream.events.find((row) => row.eventType === "POSITION_RECORDED").payload.roadMatched === false);
  const match = await f.provider.match(f.request);
  check("T251", match.status === "PASS" && match.matches.every((row) => row.confidence), match);
  const offRouteRun = Twin.createRun({ ...f.runInput, executionProfile: "OFF_ROUTE" }); const offRouteStream = Profiles.generate(offRouteRun, f.plan);
  check("T252", offRouteStream.events.some((row) => row.eventType === "OFF_ROUTE_DETECTED"));
  check("T253", offRouteStream.events.findIndex((row) => row.eventType === "ROUTE_REJOINED") > offRouteStream.events.findIndex((row) => row.eventType === "OFF_ROUTE_DETECTED"));
  const controller = Profiles.createController({ run, plan: f.plan, stream: onTimeStream }); controller.release(); const beforePause = controller.snapshot().state.acceptedEvents.length; controller.pause(); const pausedStep = controller.step();
  check("T254", pausedStep.status === "PAUSED_NO_EVENT" && controller.snapshot().state.acceptedEvents.length === beforePause);
  const beforeResumeTime = controller.snapshot().state.latestLogicalTime; controller.resume(); const resumed = controller.step();
  check("T255", resumed.status === "ACCEPTED" && resumed.event.logicalTime >= beforeResumeTime, resumed);
  check("T256", throwsCode(() => controller.reset(false), "EXECUTION_RESET_CONFIRMATION_REQUIRED"));
  const reset = controller.reset(true);
  check("T257", reset.archivedExportHash.startsWith("sha256:") && controller.snapshot().archives.includes(reset.archivedExportHash), reset);
  check("T258", exported.acceptedEvents.every((row, index) => index === 0 || exported.acceptedEvents[index - 1].sequence < row.sequence));
  check("T259", rebuilt.snapshot().acceptedEvents.every((row) => row.eventHash === Integrity.hashValue(Twin.eventIdentity(row))) && rebuilt.snapshot().executionStateHash === exported.finalExecutionStateHash);
  const pollution = JSON.parse('{"eventId":"BAD","__proto__":{"polluted":true}}');
  check("T260", throwsCode(() => Stores.createStore({ run, plan: f.plan }).append(pollution), "EXECUTION_PROTOTYPE_POLLUTION_REJECTED") && {}.polluted === undefined);
  check("T261", Twin.escapeHtml('<img src=x onerror="boom">') === "&lt;img src=x onerror=&quot;boom&quot;&gt;");
  check("T262", ["zh", "en", "ja"].every((language) => Twin.COPY[language] && Twin.RUN_STATUSES.every((status) => Twin.COPY[language][status]) && Twin.COPY[language].simulatedActual));
  const noWebGL = Profiles.createController({ run, plan: f.plan, stream: onTimeStream, noWebGL: true }); noWebGL.release(); noWebGL.play(); const noWebGLStep = noWebGL.step();
  check("T263", noWebGL.snapshot().noWebGL === true && noWebGLStep.status === "ACCEPTED" && noWebGL.snapshot().state.authority === "EXECUTION_STORE_V16");
  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks.map((row) => row.id) }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
