#!/usr/bin/env node
"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const net = require("net");
const path = require("path");
const Fixture = require("./fixtures/rolling-v16-fixture.js");
const Integrity = require("../integrity-hash-v151.js");
const Rolling = require("../rolling-plan-v16.js");
const ChangePenalty = require("../change-penalty-v16.js");
const Jobs = require("../job-lifecycle-v16.js");
const Reoptimization = require("../reoptimization-v16.js");
const RollingRecovery = require("../rolling-recovery-v16.js");

const ROOT = path.resolve(__dirname, "..");
const checks = [];
function check(id, condition, detail = {}) { assert(condition, `${id}: ${JSON.stringify(detail)}`); checks.push({ id, status: "PASS", detail }); }
function throwsCode(run, code) { try { run(); } catch (error) { return error.code === code; } return false; }
async function freePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
async function waitForHealth(port) {
  const endpoint = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { const response = await fetch(`${endpoint}/health`); if (response.ok) return endpoint; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Optimizer did not become ready on ${port}`);
}
async function startService(extraEnv = {}) {
  const port = await freePort();
  const process = childProcess.spawn("python3", ["optimizer/ortools_service.py"], { cwd: ROOT, env: { ...global.process.env, OPT_PORT: String(port), MAX_SOLVE_SECONDS: "5", ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; process.stdout.on("data", (chunk) => { output += chunk; }); process.stderr.on("data", (chunk) => { output += chunk; });
  try { return { process, endpoint: await waitForHealth(port), output: () => output }; }
  catch (error) { process.kill("SIGTERM"); throw Object.assign(error, { serviceOutput: output }); }
}
async function stopService(service) { if (!service || service.process.exitCode !== null) return; service.process.kill("SIGTERM"); await Promise.race([new Promise((resolve) => service.process.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 1500))]); if (service.process.exitCode === null) service.process.kill("SIGKILL"); }

async function main() {
  const fixture = await Fixture.create();
  const context = fixture.context;
  const scenario = fixture.scenario;
  check("T131", context.schemaVersion === "stct-rolling-plan-context-v1.6" && context.contextHash.startsWith("sha256:"), context);
  check("T132", throwsCode(() => Rolling.normalizeContext({ ...fixture.contextInput, cutoffLogicalMinute: undefined }), "ROLLING_CUTOFF_REQUIRED"));
  check("T133", throwsCode(() => Rolling.normalizeContext({ ...fixture.contextInput, executionRunHash: "" }), "ROLLING_EXECUTION_RUN_HASH_REQUIRED"));
  check("T134", throwsCode(() => Rolling.normalizeContext({ ...fixture.contextInput, executionStateHash: "" }), "ROLLING_EXECUTION_STATE_HASH_REQUIRED"));
  check("T135", context.completedStopIds.length === 1 && context.vehicleStates[0].completedStopIds.length === 1, context.completedStopIds);
  check("T136", throwsCode(() => Rolling.normalizeContext({ ...fixture.contextInput, activeStopIds: ["O1"] }), "ROLLING_ACTIVE_COMPLETED_CONFLICT"));
  check("T137", throwsCode(() => Rolling.deriveRemainingScenario(fixture.baseScenario, { ...context, remainingOrderIds: ["O2", "O3"] }), "ROLLING_REMAINING_CONSERVATION_FAIL"));
  check("T138", throwsCode(() => Rolling.normalizeContext({ ...fixture.contextInput, vehicleStates: [{ ...fixture.contextInput.vehicleStates[0], currentCoordinate: [999, 0] }] }), "ROLLING_VEHICLE_COORDINATE_INVALID"));
  check("T139", throwsCode(() => Rolling.normalizeContext({ ...fixture.contextInput, vehicleStates: [{ ...fixture.contextInput.vehicleStates[0], remainingShiftMinutes: -1 }] }), "ROLLING_REMAINING_SHIFT_INVALID"));
  check("T140", throwsCode(() => Rolling.normalizeContext({ ...fixture.contextInput, vehicleStates: [{ ...fixture.contextInput.vehicleStates[0], currentLoad: -1 }] }), "ROLLING_CURRENT_LOAD_INVALID"));
  const defaultPolicy = Rolling.normalizeContext({ ...fixture.contextInput, transferPolicy: undefined });
  check("T141", defaultPolicy.transferPolicy === "LOCK_LOADED_ORDERS_TO_VEHICLE");
  const transferViolation = Rolling.verifyCandidate({ routes: [{ routeId: "R1", vehicleId: "V2", orderIds: ["O2", "O3"] }], historicalPrefixes: context.fixedRoutePrefixes }, context);
  check("T142", transferViolation.violations.some((row) => row.code === "LOADED_ORDER_TRANSFER"), transferViolation);
  const depotContext = Rolling.normalizeContext({ ...fixture.contextInput, transferPolicy: "ALLOW_TRANSFER_AT_DEPOT", vehicleStates: fixture.contextInput.vehicleStates.map((row) => row.vehicleId === "V1" ? { ...row, atDepot: true } : row), lockedRouteIds: [] });
  const depotTransfer = Rolling.verifyCandidate({ routes: [{ routeId: "R9", vehicleId: "V2", orderIds: ["O2", "O3"] }], historicalPrefixes: depotContext.fixedRoutePrefixes }, depotContext);
  check("T143", !depotTransfer.violations.some((row) => row.code === "LOADED_ORDER_TRANSFER") && Rolling.verifyCandidate({ routes: [{ routeId: "R9", vehicleId: "V2", orderIds: ["O2", "O3"] }], historicalPrefixes: context.fixedRoutePrefixes }, { ...depotContext, vehicleStates: depotContext.vehicleStates.map((row) => ({ ...row, atDepot: false })) }).violations.some((row) => row.code === "LOADED_ORDER_TRANSFER"), depotTransfer);
  const virtualBoundary = Rolling.transferBoundary("VIRTUAL_CROSS_DOCK_SIMULATION");
  check("T144", virtualBoundary.simulationOnly && virtualBoundary.boundary.includes("Not an executed physical operation"), virtualBoundary);
  const virtualContext = Rolling.normalizeContext({ ...fixture.contextInput, transferPolicy: "VIRTUAL_CROSS_DOCK_SIMULATION" });
  check("T145", virtualContext.contextHash !== context.contextHash);
  check("T146", scenario.transferBoundary.policy === context.transferPolicy && scenario.transferBoundary.boundary.length > 0, scenario.transferBoundary);
  check("T147", !scenario.orders.some((order) => order.id === "O1") && scenario.completedStopIds.includes("O1"));

  const localRegret = Reoptimization.localCandidate("LOCAL_REGRET_INSERTION", scenario, context, fixture.matrix, { incidentHash: Integrity.hashValue({ incident: 1 }) });
  check("T148", localRegret.routes.find((route) => route.vehicleId === "V1")?.orderIds[0] === "O2", localRegret.routes);
  const cancelledFixture = await Fixture.create({ context: { cancelledOrderIds: ["O4"], remainingOrderIds: ["O2", "O3"] } });
  check("T149", !cancelledFixture.scenario.orders.some((order) => order.id === "O4"));
  const failedRemoved = await Fixture.create({ context: { failedStopIds: ["O4"], remainingOrderIds: ["O2", "O3"] }, failedStopPolicy: "REMOVE" });
  const failedRetry = await Fixture.create({ context: { failedStopIds: ["O4"] }, failedStopPolicy: "RETRY" });
  check("T150", !failedRemoved.scenario.orders.some((order) => order.id === "O4") && failedRetry.scenario.orders.find((order) => order.id === "O4")?.failedRetry === true);
  const failedVehicleInput = { ...fixture.contextInput, vehicleStates: fixture.contextInput.vehicleStates.map((row) => row.vehicleId === "V2" ? { ...row, status: "FAILED", available: false, failureReason: "SYNTHETIC_BREAKDOWN" } : row) };
  const failedVehicleScenario = Rolling.deriveRemainingScenario(fixture.baseScenario, Rolling.normalizeContext(failedVehicleInput), { endPointByVehicle: { V1: "DEPOT_END", V2: "DEPOT_END" }, generatedAt: "2026-08-31T00:00:00.000Z" });
  check("T151", failedVehicleScenario.vehicles.find((vehicle) => vehicle.id === "V2")?.available === false);
  check("T152", scenario.vehicles.find((vehicle) => vehicle.id === "V1")?.startPointId === "V1_START");
  check("T153", scenario.vehicles.every((vehicle) => vehicle.startMinute === context.cutoffLogicalMinute));
  check("T154", scenario.vehicles.find((vehicle) => vehicle.id === "V1")?.endMinute === context.cutoffLogicalMinute + 540);
  check("T155", scenario.inputHash.startsWith("sha256:") && scenario.inputHash === Integrity.hashValue(Rolling.scenarioIdentity(scenario)));

  const incidentHash = Integrity.hashValue({ incident: "SYNTHETIC-CLOSURE" });
  const request = Reoptimization.buildSolveRequest(scenario, context, fixture.matrix, { incidentHash, timeLimitSeconds: 2 });
  let service;
  try {
    service = await startService();
    const adapter = Reoptimization.createHttpAdapter({ endpoint: service.endpoint });
    const response = await adapter(request, { timeoutMs: 10000 });
    check("T156", response.ok && response.matrixHash === fixture.matrix.matrixHash, response);
    const staleRequest = structuredClone(request); staleRequest.authoritativeMatrix.distances[0][1] += 0.001;
    const staleResponse = await fetch(`${service.endpoint}/reoptimize-v16`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(staleRequest) });
    const staleBody = await staleResponse.json();
    check("T157", staleResponse.status === 400 && staleBody.error.code === "MATRIX_HASH_STALE", staleBody);
    const mappingRequest = structuredClone(request); [mappingRequest.matrixPointIds[0], mappingRequest.matrixPointIds[1]] = [mappingRequest.matrixPointIds[1], mappingRequest.matrixPointIds[0]];
    const mappingResponse = await fetch(`${service.endpoint}/reoptimize-v16`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mappingRequest) });
    const mappingBody = await mappingResponse.json();
    check("T158", mappingResponse.status === 400 && mappingBody.error.code === "MATRIX_POINT_MAPPING_MISMATCH", mappingBody);
    check("T159", response.matrixProvenance.authoritative === true && response.matrixProvenance.fallbackUsed === false && !response.matrixProvenance.haversineSubstituted, response.matrixProvenance);
    check("T160", response.engine === "OR-Tools" && response.actualOrtoolsVersion && response.requestHash === request.claimedRequestHash, response);
    const full = Reoptimization.normalizeFullCandidate(response, scenario, context, fixture.matrix, { incidentHash });
    check("T161", full.engineVersion === response.actualOrtoolsVersion);
    check("T162", full.matrixHash === fixture.matrix.matrixHash);
    check("T163", full.inputHash === scenario.inputHash);
    check("T164", full.incidentHash === incidentHash);
    check("T165", full.pinningHash === Rolling.verifyCandidate(full, context).pinningHash && full.pinningHash.startsWith("sha256:"));
    check("T166", JSON.stringify(full.historicalPrefixes) === JSON.stringify(context.fixedRoutePrefixes));
    check("T167", full.routes.find((route) => route.vehicleId === "V1")?.orderIds[0] === "O2", full.routes);
    check("T168", full.routes.some((route) => route.routeId === "R1" && route.vehicleId === "V1"), full.routes);
    check("T169", full.routes.find((route) => route.orderIds.includes("O3"))?.vehicleId === "V1", full.routes);
    const invalid = structuredClone(full); invalid.routes.find((route) => route.vehicleId === "V1").orderIds = ["O3", "O2"];
    check("T170", Rolling.verifyCandidate(invalid, context).status === "FAIL", Rolling.verifyCandidate(invalid, context));
    const pool = await Reoptimization.candidatePool({ basePlan: fixture.basePlan, scenario, context, matrix: fixture.matrix, incidentHash, timeLimitSeconds: 2, fullAdapter: adapter, timeoutMs: 10000 });
    check("T171", pool.candidates.some((candidate) => candidate.candidateType === "LOCAL_REGRET_INSERTION"));
    check("T172", pool.candidates.some((candidate) => candidate.candidateType === "LOCAL_RUIN_RECREATE"));
    check("T173", pool.candidates.some((candidate) => candidate.candidateType === "FULL_REOPTIMIZATION_OR_TOOLS"));
    check("T174", pool.candidates.some((candidate) => candidate.candidateType === "CARRY_FORWARD_REFERENCE" && candidate.reference));
    check("T175", pool.candidates.filter((candidate) => !candidate.reference).every((candidate) => candidate.verification.status === "PASS"), pool.candidates.map((candidate) => candidate.verification.status));
    check("T176", pool.serviceLayer.comparable.length === 3 && pool.serviceLayer.reference.reference === true && pool.serviceLayer.matrixHash === fixture.matrix.matrixHash, pool.serviceLayer);
    const fullCandidate = pool.candidates.find((candidate) => candidate.candidateType === "FULL_REOPTIMIZATION_OR_TOOLS");
    const session = RollingRecovery.createSession({ basePlan: fixture.basePlan, context, incidentHash });
    const ingested = session.ingest(pool, { generation: 0 });
    check("T183", ingested.observedPareto.rows.some((row) => row.fullReoptimization && row.planHash === fullCandidate.planHash), ingested.observedPareto);
    const preview = session.preview(fullCandidate.planHash);
    check("T184", preview.status === "PREVIEW" && preview.planHash === fullCandidate.planHash && preview.handover.afterLabel.includes("Planned"), preview);
    const applied = session.apply(fullCandidate.planHash);
    check("T185", applied.status === "APPLIED");
    check("T186", applied.plan.planHash === fullCandidate.planHash);
    check("T187", applied.planRevision.revision === fixture.basePlan.revision + 1 && applied.planRevision.revisionHash.startsWith("sha256:"), applied.planRevision);
    const undoSession = RollingRecovery.createSession({ basePlan: fixture.basePlan, context, incidentHash }); undoSession.ingest(pool); undoSession.apply(fullCandidate.planHash);
    const undone = undoSession.undo();
    check("T188", undone.status === "UNDONE" && undone.plan.planHash === fixture.basePlan.planHash, undone);
    session.recordPostRecoveryEvent({ eventId: "ACK-1", eventHash: Integrity.hashValue({ eventId: "ACK-1" }), eventType: "EVENT_ACKNOWLEDGED", logicalTime: context.cutoffLogicalMinute + 1, ackId: "ACK-1", accepted: true });
    check("T189", throwsCode(() => session.undo(), "RECOVERY_UNDO_BLOCKED_BY_ACK"));
    const counter = session.createCounterRecovery();
    check("T190", counter.counterRecoveryHash.startsWith("sha256:") && counter.parentRecoveryPlanHash === fullCandidate.planHash, counter);
    const cancellable = Jobs.create(); const cancelJob = cancellable.submit("sha256:cancel");
    check("T191", cancellable.cancel(cancelJob.jobId).state === "CANCELLED");
    const staleSession = RollingRecovery.createSession({ basePlan: fixture.basePlan, context, incidentHash }); const staleGeneration = staleSession.beginGeneration(); staleSession.beginGeneration();
    check("T192", throwsCode(() => staleSession.ingest(pool, { generation: staleGeneration }), "STALE_JOB_RESPONSE"));
    const duplicateJobs = Jobs.create(); const duplicateFirst = duplicateJobs.submit("sha256:duplicate"); duplicateJobs.transition(duplicateFirst.jobId, "QUEUED");
    check("T193", duplicateJobs.submit("sha256:duplicate").duplicate === true);
    check("T194", fullCandidate.solverStatus === "BEST_FOUND_WITHIN_LIMIT", fullCandidate.solverStatus);
    check("T195", fullCandidate.optimalityClaim === "NOT_CLAIMED" && !JSON.stringify(fullCandidate).toLowerCase().includes("global optimum"));
    check("T197", RollingRecovery.fullAvailability({ providerId: "ESTIMATED_HAVERSINE_FALLBACK", estimated: true }, { available: true }).fullAvailable === false);
    const fakeBody = structuredClone(response); delete fakeBody.transportEvidence;
    const fakeCandidate = Reoptimization.normalizeFullCandidate(fakeBody, scenario, context, fixture.matrix, { incidentHash });
    check("T198", fakeCandidate.integrationEvidence.status === "UNIT_CALLBACK_ONLY" && fakeCandidate.integrationEvidence.status !== "VERIFIED_HTTP_INTEGRATION", fakeCandidate.integrationEvidence);
    const lineage = session.exportLineage();
    check("T199", lineage.basePlanHash === fixture.basePlan.planHash && lineage.currentPlanHash === fullCandidate.planHash && lineage.contextHash === context.contextHash && lineage.matrixHash === fixture.matrix.matrixHash && lineage.actions.some((row) => row.action === "APPLY") && lineage.actions.some((row) => row.action === "COUNTER_RECOVERY_CREATED") && lineage.candidateSummaries.find((row) => row.candidateType === "FULL_REOPTIMIZATION_OR_TOOLS")?.integrationEvidence?.status === "VERIFIED_HTTP_INTEGRATION", lineage);
  } catch (error) {
    error.serviceOutput = service?.output?.() || "";
    throw error;
  } finally { await stopService(service); }

  let unavailableService;
  try {
    unavailableService = await startService({ DISABLE_ORTOOLS: "1" });
    const unavailableResponse = await fetch(`${unavailableService.endpoint}/reoptimize-v16`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
    const unavailableBody = await unavailableResponse.json();
    check("T196", unavailableResponse.status === 503 && unavailableBody.availability === "SKIPPED_DEPENDENCY" && unavailableBody.error.code === "ORTOOLS_UNAVAILABLE", unavailableBody);
  } finally { await stopService(unavailableService); }

  const penaltyBase = { routes: [{ routeId: "A", vehicleId: "V1", orderIds: ["X", "Y"], etaByOrder: { X: 10, Y: 20 } }, { routeId: "B", vehicleId: "V2", orderIds: ["Z"], etaByOrder: { Z: 30 } }] };
  const penaltyNext = { routes: [{ routeId: "A", vehicleId: "V1", orderIds: ["Y"], etaByOrder: { Y: 28 } }, { routeId: "B", vehicleId: "V2", orderIds: ["Z", "X"], etaByOrder: { Z: 35, X: 45 } }], historicalPrefixes: [] };
  const penalty = ChangePenalty.calculate(penaltyBase, penaltyNext, { loadedOrderAssignments: [{ orderId: "X", vehicleId: "V1" }], fixedRoutePrefixes: [] });
  check("T177", penalty.raw.movedOrders === 1, penalty.raw);
  check("T178", penalty.raw.changedVehicles === 2, penalty.raw);
  check("T179", penalty.raw.resequencedStops === 2, penalty.raw);
  check("T180", penalty.raw.etaShiftTotal === 48 && penalty.raw.etaShiftMax === 35, penalty.raw);
  check("T181", penalty.rows.find((row) => row.id === "driverDisruption").contribution === 2 * penalty.weights.driverDisruption, penalty.rows);
  check("T182", penalty.rows.find((row) => row.id === "loadedOrderTransfer").contribution === penalty.weights.loadedOrderTransfer, penalty.rows);

  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks.map((row) => row.id) }, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error); if (error.serviceOutput) console.error(error.serviceOutput); process.exit(1); });
