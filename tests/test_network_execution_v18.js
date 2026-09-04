#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Contract = require("../network-contract-v18.js");
const Network = require("../network-solver-v18.js");
const Execution = require("../network-execution-v18.js");
const { makeNetwork } = require("./fixtures/network-v18-fixture.js");

const assertions = [];
function check(requirementId, condition, observed, expected, negative = false) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, negative, evidence: "tests/test_network_execution_v18.js" };
  assertions.push(row); assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}
function errorCode(fn) { try { fn(); return ""; } catch (error) { return error.code || error.message; } }
function sourceFixture(options = {}) { const source = makeNetwork({ orderCount: 8, depotCount: 1, vehicleCount: 2, ...options }); source.depots.forEach((depot) => { depot.capacity.dailyOrders = 100000; depot.capacity.volume = 100000; depot.capacity.weight = 100000; depot.capacity.handlingMinutes = 100000; }); return source; }

const source = sourceFixture({ orderCount: 16, depotCount: 2, vehicleCount: 2 }); const plan = Network.solveNetwork(source, { maxStopsPerTrip: 2 }); const run = Execution.createRun(source, plan, { runId: "RUN-GATE9" }); const initialExecutionHash = run.executionNetworkHash;
const trip1 = run.trips["V1-T1"]; const trip2 = run.trips["V1-T2"]; const otherTrip = run.trips["V1-T3"]; const dockId = "DOCK-1-A"; const waveId = Object.keys(run.waves).find((id) => run.waves[id].depotId === "D1"); let logicalMinute = 400;
function append(eventType, trip = null, extra = {}) { logicalMinute += 1; return Execution.appendEvent(run, { eventType, logicalMinute, tripId: trip?.tripId || "", vehicleId: trip?.vehicleId || extra.vehicleId || "", driverId: trip?.driverId || extra.driverId || "", depotId: extra.depotId || trip?.startDepotId || "", ...extra }); }

const checkedIn = append("DEPOT_CHECKED_IN", null, { vehicleId: trip1.vehicleId, depotId: trip1.startDepotId });
check("T0620", checkedIn.eventType === "DEPOT_CHECKED_IN" && run.vehicles[trip1.vehicleId].status === "AT_DEPOT", checkedIn, "depot check-in event");
const queued = append("DOCK_QUEUED", trip1, { dockId });
check("T0621", queued.eventType === "DOCK_QUEUED" && run.docks[dockId].queuedTripIds.includes(trip1.tripId), run.docks[dockId], "dock queued event");
const assigned = append("DOCK_ASSIGNED", trip1, { dockId });
check("T0622", assigned.eventType === "DOCK_ASSIGNED" && run.docks[dockId].activeTripIds.includes(trip1.tripId), run.docks[dockId], "dock assigned event");
const loading = append("LOADING_STARTED", trip1, { dockId });
check("T0623", loading.eventType === "LOADING_STARTED" && run.trips[trip1.tripId].state === "LOADING", run.trips[trip1.tripId].state, "loading started");
const capacityError = errorCode(() => append("DOCK_ASSIGNED", otherTrip, { dockId })); append("DOCK_CONFLICT", otherTrip, { dockId, payload: { reasonCode: capacityError } });
const loaded = append("LOADING_COMPLETED", trip1, { dockId }); const trip1Load = structuredClone(run.vehicles[trip1.vehicleId].currentLoad);
check("T0624", loaded.eventType === "LOADING_COMPLETED" && run.trips[trip1.tripId].state === "LOADED", run.trips[trip1.tripId].state, "loading completed");
const released = append("TRIP_RELEASED", trip1);
check("T0625", released.eventType === "TRIP_RELEASED" && run.trips[trip1.tripId].state === "RELEASED", run.trips[trip1.tripId].state, "trip released");
const departed = append("TRIP_DEPARTED", trip1);
check("T0626", departed.eventType === "TRIP_DEPARTED" && run.trips[trip1.tripId].state === "DEPARTED", run.trips[trip1.tripId].state, "trip departed");
const currentDriverAtDeparture = structuredClone(run.drivers[trip1.driverId]);
const predecessorBlock = errorCode(() => append("TRIP_RELEASED", trip2));
const illegalTransition = errorCode(() => append("TRIP_DEPARTED", trip2));
const returned = append("TRIP_RETURNED", trip1, { depotId: trip1.endDepotId });
check("T0627", returned.eventType === "TRIP_RETURNED" && run.trips[trip1.tripId].state === "RETURNED", run.trips[trip1.tripId].state, "trip returned");
const unloading = append("UNLOADING_STARTED", trip1, { dockId: "DOCK-1-B" });
check("T0628", unloading.eventType === "UNLOADING_STARTED" && run.trips[trip1.tripId].state === "UNLOADING", run.trips[trip1.tripId].state, "unloading started");
const unloaded = append("UNLOADING_COMPLETED", trip1, { dockId: "DOCK-1-B" });
check("T0629", unloaded.eventType === "UNLOADING_COMPLETED" && run.trips[trip1.tripId].state === "COMPLETED", run.trips[trip1.tripId].state, "unloading completed");
const reloadBlock = errorCode(() => append("TRIP_RELEASED", trip2));
const reloadStarted = append("RELOAD_STARTED", trip2, { dockId });
check("T0630", reloadStarted.eventType === "RELOAD_STARTED" && run.trips[trip2.tripId].state === "RELOADING", run.trips[trip2.tripId].state, "reload started");
const reloadCompleted = append("RELOAD_COMPLETED", trip2, { dockId });
check("T0631", reloadCompleted.eventType === "RELOAD_COMPLETED" && run.trips[trip2.tripId].reloadCompleted, run.trips[trip2.tripId], "reload completed");
const breakBlock = errorCode(() => append("TRIP_RELEASED", trip2));
const breakStarted = append("BREAK_STARTED", trip2);
check("T0632", breakStarted.eventType === "BREAK_STARTED" && run.drivers[trip2.driverId].breakState === "STARTED", run.drivers[trip2.driverId], "break started");
const breakCompleted = append("BREAK_COMPLETED", trip2);
check("T0633", breakCompleted.eventType === "BREAK_COMPLETED" && run.drivers[trip2.driverId].breakState === "COMPLETED", run.drivers[trip2.driverId], "break completed");

const custodySource = sourceFixture({ orderCount: 4, depotCount: 2, vehicleCount: 4, pickupDelivery: true, crossDock: true }); const custodyPlan = Network.solveNetwork(custodySource, { maxStopsPerTrip: 2, crossDock: true }); const custodyRun = Execution.createRun(custodySource, custodyPlan, { runId: "RUN-CUSTODY" }); const shipmentIds = Object.keys(custodyRun.custody); const transfer = custodyPlan.custody.transfers[0];
const received = Execution.appendEvent(custodyRun, { eventType: "TRANSFER_RECEIVED", shipmentId: shipmentIds[0], transferId: transfer.transferId, depotId: transfer.depotId, logicalMinute: 500 });
check("T0634", received.eventType === "TRANSFER_RECEIVED" && custodyRun.custody[shipmentIds[0]].state === "RECEIVED", custodyRun.custody[shipmentIds[0]], "transfer received");
const transferReleased = Execution.appendEvent(custodyRun, { eventType: "TRANSFER_RELEASED", shipmentId: shipmentIds[0], transferId: transfer.transferId, depotId: transfer.depotId, vehicleId: transfer.outboundVehicleId, logicalMinute: 501 });
check("T0635", transferReleased.eventType === "TRANSFER_RELEASED" && custodyRun.custody[shipmentIds[0]].state === "RELEASED", custodyRun.custody[shipmentIds[0]], "transfer released");
const waveReleased = append("WAVE_RELEASED", null, { waveId, depotId: run.waves[waveId].depotId });
check("T0636", waveReleased.eventType === "WAVE_RELEASED" && run.waves[waveId].state === "RELEASED", run.waves[waveId], "wave released");
const waveDeparted = append("WAVE_DEPARTED", null, { waveId, depotId: run.waves[waveId].depotId });
check("T0637", waveDeparted.eventType === "WAVE_DEPARTED" && run.waves[waveId].state === "DEPARTED", run.waves[waveId], "wave departed");
check("T0638", capacityError === "EXECUTION_DOCK_CAPACITY_EXCEEDED" && run.conflicts.some((row) => row.type === "DOCK_CONFLICT"), { capacityError, conflicts: run.conflicts }, "dock conflict captured", true);
Execution.appendEvent(custodyRun, { eventType: "MISSED_TRANSFER", shipmentId: shipmentIds[1], transferId: custodyPlan.custody.transfers[1].transferId, depotId: custodyPlan.custody.transfers[1].depotId, logicalMinute: 502 });
check("T0639", custodyRun.custody[shipmentIds[1]].state === "MISSED", custodyRun.custody[shipmentIds[1]], "missed transfer captured", true);
check("T0640", run.trips[trip1.tripId].state === "COMPLETED" && run.trips[trip1.tripId].eventIds.length >= 9, run.trips[trip1.tripId], "trip state transitions complete");
check("T0641", illegalTransition === "EXECUTION_TRIP_TRANSITION_ILLEGAL", illegalTransition, "illegal trip transition rejected", true);
check("T0642", predecessorBlock === "PREDECESSOR_TRIP_NOT_TERMINAL", predecessorBlock, "Trip 2 blocked before Trip 1 terminal", true);
check("T0643", reloadBlock === "TRIP_RELOAD_REQUIRED", reloadBlock, "Trip 2 blocked before reload", true);
check("T0644", breakBlock === "TRIP_BREAK_REQUIRED", breakBlock, "Trip 2 blocked before break", true);
check("T0645", currentDriverAtDeparture.currentTripId === trip1.tripId && currentDriverAtDeparture.status === "ON_TRIP", currentDriverAtDeparture, "driver current trip correct");
check("T0646", currentDriverAtDeparture.nextTripId === trip2.tripId, currentDriverAtDeparture.nextTripId, "driver next trip correct");
check("T0647", trip1Load.orderIds.length === trip1.orderIds.length && trip1Load.volume > 0 && trip1Load.weight > 0, trip1Load, "current load correct");
check("T0648", custodyRun.custody[shipmentIds[0]].state === "RELEASED" && custodyRun.custody[shipmentIds[0]].ownerType === "VEHICLE" && custodyRun.custody[shipmentIds[0]].eventIds.length === 2, custodyRun.custody[shipmentIds[0]], "custody execution correct");
check("T0649", run.docks[dockId].activeTripIds.length <= run.docks[dockId].capacity, run.docks[dockId], "dock execution capacity");
check("T0650", run.waves[waveId].state === "DEPARTED", run.waves[waveId], "wave execution state");
check("T0651", Contract.isSha256(run.executionRunHash), run.executionRunHash, "multi-depot execution run hash");
check("T0652", Contract.isSha256(run.executionNetworkHash) && run.executionNetworkHash !== initialExecutionHash, { before: initialExecutionHash, after: run.executionNetworkHash }, "execution network hash");
check("T0653", Execution.stream(run, "depotId", "D1").length > 0, Execution.stream(run, "depotId", "D1").length, "per-depot event stream");
check("T0654", Execution.stream(run, "vehicleId", trip1.vehicleId).length > 0, Execution.stream(run, "vehicleId", trip1.vehicleId).length, "per-vehicle event stream");
check("T0655", Execution.stream(run, "driverId", trip1.driverId).length > 0, Execution.stream(run, "driverId", trip1.driverId).length, "per-driver event stream");

Execution.queueOfflineEvent(run, { eventType: "OFFLINE_EVENT", tripId: trip1.tripId, vehicleId: trip1.vehicleId, clientEventId: "OFF-1", idempotencyKey: "OFF-ID-1", payload: { stage: "TRIP_1" } });
Execution.queueOfflineEvent(run, { eventType: "OFFLINE_EVENT", tripId: trip2.tripId, vehicleId: trip2.vehicleId, clientEventId: "OFF-2", idempotencyKey: "OFF-ID-2", payload: { stage: "TRIP_2" } });
const offlineConflict = Execution.detectOfflineConflict(run, { idempotencyKey: "OFF-ID-2", payload: { stage: "ALTERED" } }); const reconciled = Execution.reconcileOffline(run);
check("T0656", reconciled.accepted.length === 2 && new Set(reconciled.accepted.map((row) => row.tripId)).size === 2, reconciled, "offline events across trips");
check("T0657", reconciled.status === "ACKNOWLEDGED" && run.acknowledgements.some((row) => row.tripId === trip2.tripId), run.acknowledgements, "ACK across trip boundary");
check("T0658", offlineConflict.status === "CONFLICT" && offlineConflict.reasonCode === "IDEMPOTENCY_REUSE", offlineConflict, "conflict across trip boundary", true);

const incidents = {}; for (const type of Execution.INCIDENT_TYPES) incidents[type] = Execution.createIncident(run, type, { depotId: "D1", dockId, vehicleId: trip2.vehicleId, driverId: trip2.driverId, transferId: "TRANSFER-1", waveId, closureId: "CLOSE-1", demandFactor: 1.5 });
check("T0659", incidents.DEPOT_OUTAGE.incidentType === "DEPOT_OUTAGE", incidents.DEPOT_OUTAGE, "depot outage incident");
check("T0660", incidents.DOCK_FAILURE.dockId === dockId, incidents.DOCK_FAILURE, "dock failure incident");
check("T0661", incidents.VEHICLE_BREAKDOWN.vehicleId === trip2.vehicleId, incidents.VEHICLE_BREAKDOWN, "vehicle breakdown incident");
check("T0662", incidents.DRIVER_UNAVAILABLE.driverId === trip2.driverId, incidents.DRIVER_UNAVAILABLE, "driver unavailable incident");
check("T0663", incidents.MISSED_TRANSFER.transferId === "TRANSFER-1", incidents.MISSED_TRANSFER, "missed transfer incident");
check("T0664", incidents.WAVE_DELAY.waveId === waveId, incidents.WAVE_DELAY, "wave delay incident");
check("T0665", incidents.ROAD_CLOSURE.closureId === "CLOSE-1", incidents.ROAD_CLOSURE, "road closure incident");
check("T0666", incidents.DEMAND_SURGE.demandFactor === 1.5, incidents.DEMAND_SURGE, "demand surge incident");

append("TRIP_RELEASED", trip2); append("TRIP_DEPARTED", trip2); const environment = { matrixHash: "sha256:" + "1".repeat(64), dockHash: Contract.hashArtifact(run.docks), waveHash: Contract.hashArtifact(run.waves), transferPolicy: "LOCK_EXECUTED_CUSTODY", serviceLayer: "SERVICE_FIRST", logicalMinute };
const cutoff = Execution.freezeCutoff(run, environment);
check("T0667", cutoff.currentTrips.some((row) => row.tripId === trip2.tripId && row.state === "DEPARTED"), cutoff.currentTrips, "cutoff includes current trip");
check("T0668", cutoff.dockSchedule[dockId].capacity === run.docks[dockId].capacity, cutoff.dockSchedule[dockId], "cutoff includes dock schedule");
check("T0669", cutoff.custodyHash === Contract.hashArtifact(cutoff.custody), cutoff.custodyHash, "cutoff includes custody");
check("T0670", cutoff.breakState.some((row) => row.driverId === trip2.driverId && row.state === "COMPLETED"), cutoff.breakState, "cutoff includes break state");
const recoveryStarted = performance.now(); const candidates = Execution.generateRecoveryCandidates(run, cutoff, { ...environment, incidentHash: incidents.VEHICLE_BREAKDOWN.incidentHash }); const recoveryElapsed = performance.now() - recoveryStarted;
check("T0671", candidates.some((row) => row.candidateType === "LOCAL_TRIP_REPAIR"), candidates.map((row) => row.candidateType), "local trip repair");
check("T0672", candidates.some((row) => row.candidateType === "REASSIGN_OTHER_DEPOT"), candidates.map((row) => row.candidateType), "reassign other depot");
check("T0673", candidates.some((row) => row.candidateType === "ADD_EXTRA_TRIP"), candidates.map((row) => row.candidateType), "add extra trip");
check("T0674", candidates.some((row) => row.candidateType === "SWAP_VEHICLE"), candidates.map((row) => row.candidateType), "swap vehicle");
check("T0675", candidates.some((row) => row.candidateType === "RESCHEDULE_DOCK"), candidates.map((row) => row.candidateType), "reschedule dock");
check("T0676", candidates.some((row) => row.candidateType === "DELAY_WAVE"), candidates.map((row) => row.candidateType), "delay wave");
check("T0677", candidates.some((row) => row.candidateType === "FULL_NETWORK_REOPT" && row.engine === "LOCAL_NETWORK_SOLVER" && row.label.includes("not global optimum")), candidates.find((row) => row.candidateType === "FULL_NETWORK_REOPT"), "full network reoptimization candidate");
check("T0678", candidates.every((row) => row.carryForward.eventHashes.length === cutoff.eventHashes.length && row.carryForward.currentTripIds.includes(trip2.tripId)), candidates[0].carryForward, "carry-forward reference");
check("T0679", candidates.every((row) => row.verification.status === "PASS" && row.verification.verifier === "UNIFIED_NETWORK_RECOVERY_VERIFIER"), candidates.map((row) => row.verification), "all candidates unified verifier");
check("T0680", new Set(candidates.map((row) => row.matrixHash)).size === 1 && candidates[0].matrixHash === environment.matrixHash, candidates.map((row) => row.matrixHash), "all candidates unified matrix");
check("T0681", new Set(candidates.map((row) => row.serviceLayer)).size === 1 && candidates[0].serviceLayer === "SERVICE_FIRST", candidates.map((row) => row.serviceLayer), "all candidates unified service layer");
check("T0682", candidates.every((row) => ["changedTrips", "reassignedOrders", "changedDepots", "delayedMinutes", "addedDistanceKm"].every((key) => Number.isFinite(row.disruption[key]))), candidates.map((row) => row.disruption), "recovery disruption metrics");

const session = Execution.createRecoverySession(run, cutoff, candidates, environment); const applied = session.apply(candidates[0].planHash);
check("T0683", applied.status === "APPLIED" && applied.planRevision.revision === run.revision + 1 && Contract.isSha256(applied.planRevision.revisionHash), applied.planRevision, "apply Network Revision");
check("T0684", JSON.stringify(applied.handover.historicalEventHashes) === JSON.stringify(cutoff.eventHashes) && JSON.stringify(session.snapshot().historicalEventHashes) === JSON.stringify(cutoff.eventHashes), applied.handover.historicalEventHashes, "historical events immutable");
check("T0685", applied.handover.futurePlanHash === candidates[0].planHash && applied.handover.plannedFromLogicalMinute === cutoff.logicalMinute, applied.handover, "future plan handover");
session.recordAck({ eventId: "POST-RECOVERY-ACK", logicalMinute: cutoff.logicalMinute + 1 }); const undoBlocked = errorCode(() => session.undo());
check("T0686", undoBlocked === "RECOVERY_UNDO_BLOCKED_BY_ACK", undoBlocked, "ACK after recovery blocks simple undo", true);
const counter = session.counterRecovery();
check("T0687", Contract.isSha256(counter.counterRecoveryHash) && counter.parentRecoveryPlanHash === candidates[0].planHash, counter, "counter-recovery");
check("T0688", errorCode(() => Execution.createRecoverySession(run, cutoff, candidates, environment).apply("sha256:" + "0".repeat(64))) === "STALE_RECOVERY_REJECTED", "STALE_RECOVERY_REJECTED", "stale recovery rejected", true);
check("T0689", Execution.verifyRecoveryCandidate(candidates[0], cutoff, { matrixHash: "sha256:" + "2".repeat(64) }).issues.includes("STALE_RECOVERY_MATRIX"), Execution.verifyRecoveryCandidate(candidates[0], cutoff, { matrixHash: "sha256:" + "2".repeat(64) }), "matrix mutation rejects old recovery", true);
check("T0690", Execution.verifyRecoveryCandidate(candidates[0], cutoff, { dockHash: "sha256:" + "3".repeat(64) }).issues.includes("STALE_RECOVERY_DOCK"), Execution.verifyRecoveryCandidate(candidates[0], cutoff, { dockHash: "sha256:" + "3".repeat(64) }), "dock mutation rejects old recovery", true);
check("T0691", Execution.verifyRecoveryCandidate(candidates[0], cutoff, { waveHash: "sha256:" + "4".repeat(64) }).issues.includes("STALE_RECOVERY_WAVE"), Execution.verifyRecoveryCandidate(candidates[0], cutoff, { waveHash: "sha256:" + "4".repeat(64) }), "wave mutation rejects old recovery", true);
check("T0692", Execution.verifyRecoveryCandidate(candidates[0], cutoff, { transferPolicy: "ALLOW_FREE_TRANSFER" }).issues.includes("STALE_RECOVERY_TRANSFER_POLICY"), Execution.verifyRecoveryCandidate(candidates[0], cutoff, { transferPolicy: "ALLOW_FREE_TRANSFER" }), "transfer policy mutation rejects old recovery", true);
const view = Execution.executionView(run);
check("T0693", view.drivers.length === source.drivers.length && view.drivers.every((row) => Object.hasOwn(row, "currentTrip") && Object.hasOwn(row, "nextTrip") && Object.hasOwn(row, "depotId")), view.drivers, "multi-depot driver UI");
check("T0694", view.noWebGL.operational === true && view.noWebGL.tables.includes("custody"), view.noWebGL, "no-WebGL execution");
check("T0695", view.mobile.bottomSheet === true && view.mobile.autoApply === false, view.mobile, "mobile recovery");
const capsule = Execution.createCapsule(run, cutoff, candidates); const replay = Execution.replay(capsule);
check("T0696", replay.status === "EQUIVALENT" && replay.autoApply === false && replay.externalRequests === false, replay, "capsule execution replay");
const historyMutation = structuredClone(capsule); historyMutation.events[0].payload.rewritten = true;
check("T0697", Execution.replay(historyMutation).status === "MISMATCH", Execution.replay(historyMutation), "rewrite history mutation caught", true);
const custodyMutation = structuredClone(candidates[0]); custodyMutation.carryForward.custodyHash = ""; const custodyHashPayload = structuredClone(custodyMutation); delete custodyHashPayload.planHash; custodyMutation.planHash = Contract.hashArtifact(custodyHashPayload);
check("T0698", Execution.verifyRecoveryCandidate(custodyMutation, cutoff).issues.includes("RECOVERY_CUSTODY_IGNORED"), Execution.verifyRecoveryCandidate(custodyMutation, cutoff), "ignore custody at recovery mutation caught", true);
check("T0699", Number.isFinite(recoveryElapsed) && recoveryElapsed >= 0, recoveryElapsed, "recovery performance measured");
check("T0700", ["zh", "en", "ja"].every((locale) => ["EXECUTION", "RECOVERY", "CURRENT_TRIP", "NEXT_TRIP", "TESTED_CANDIDATE"].every((code) => Execution.term(code, locale) !== code)), ["zh", "en", "ja"].map((locale) => Execution.term("RECOVERY", locale)), "Chinese English Japanese labels");
const audit = Execution.audit(run, session);
check("T0701", audit.status === "PASS" && audit.acceptedEvents === run.events.length && audit.eventHashes.length === run.events.length && audit.incidents.length === Execution.INCIDENT_TYPES.length && audit.recoveryActions.length >= 3, audit, "complete execution and recovery audit");

assert.strictEqual(assertions.length, 82, "Gate 9 must contain exactly T0620-T0701");
process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, recoveryPerformanceMs: recoveryElapsed, executionRunHash: run.executionRunHash, executionNetworkHash: run.executionNetworkHash, eventCount: run.events.length, incidentCount: run.incidents.length, candidateTypes: candidates.map((row) => row.candidateType), assertions }, null, 2)}\n`);
