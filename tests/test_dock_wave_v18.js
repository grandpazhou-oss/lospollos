#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Contract = require("../network-contract-v18.js");
const Trip = require("../trip-chain-v18.js");
const Custody = require("../pickup-custody-v18.js");
const DockWave = require("../dock-wave-v18.js");
const { makeNetwork } = require("./fixtures/network-v18-fixture.js");

const assertions = [];
function check(requirementId, condition, observed, expected, negative = false) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, negative, evidence: "tests/test_dock_wave_v18.js" };
  assertions.push(row); assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}
const clone = (value) => structuredClone(value);
function baseSource(orderCount = 8, vehicleCount = 2) { const source = makeNetwork({ depotCount: 1, vehicleCount, orderCount }); source.depots[0].capacity.volume = 100000; source.depots[0].capacity.weight = 100000; return source; }
function makePlan(source, maxStopsPerTrip = 2) { return Trip.planTrips(source, { maxStopsPerTrip, startTime: "08:00" }); }

const source = baseSource(); const tripPlan = makePlan(source); const schedule = DockWave.scheduleDocks(source, tripPlan); const normalized = Contract.normalizeScenario(source); const dock = normalized.docks[0]; const reservation = schedule.reservations[0];
check("T0332", dock.dockId && dock.depotId && dock.type && Array.isArray(dock.compatibleVehicleTypes) && dock.simultaneousCapacity >= 1, dock, "normalized dock schema");
check("T0333", normalized.depots.some((depot) => depot.depotId === dock.depotId), dock.depotId, "depot exists");
check("T0334", schedule.reservations.every((row) => DockWave.operationCompatible(normalized.docks.find((item) => item.dockId === row.dockId), row.operation)), schedule.reservations.map((row) => [row.dockId, row.operation]), "operation/type compatible");
check("T0335", schedule.reservations.every((row) => { const vehicle = normalized.vehicles.find((item) => item.vehicleId === row.vehicleId); return normalized.docks.find((item) => item.dockId === row.dockId).compatibleVehicleTypes.includes(vehicle.vehicleTypeId); }), schedule.reservations.map((row) => row.vehicleId), "vehicle type compatible");
check("T0336", DockWave.verifyDockSchedule(source, tripPlan, schedule).status === "PASS", DockWave.verifyDockSchedule(source, tripPlan, schedule), "operating windows valid");
check("T0337", normalized.docks.every((item) => DockWave.verifyCapacity(item, schedule.reservations.filter((row) => row.dockId === item.dockId)).status === "PASS"), schedule.metrics, "simultaneous capacity");
check("T0338", dock.loadRate > 0, dock.loadRate, ">0 load rate");
check("T0339", normalized.docks.every((item) => item.unloadRate > 0), normalized.docks.map((item) => item.unloadRate), ">0 unload rate");
check("T0340", normalized.docks.every((item) => item.fixedSetupMinutes >= 0), normalized.docks.map((item) => item.fixedSetupMinutes), "fixed setup normalized");
check("T0341", reservation.reservationId && reservation.dockId && reservation.vehicleId && reservation.tripId && reservation.operation && reservation.status === "SCHEDULED", reservation, "reservation schema");
check("T0342", schedule.reservations.every((row) => row.startMinute < row.endMinute), schedule.reservations.map((row) => [row.startMinute, row.endMinute]), "valid intervals");
check("T0343", schedule.reservations.every((row) => normalized.docks.some((item) => item.dockId === row.dockId)), schedule.reservations.map((row) => row.dockId), "dock exists");
check("T0344", schedule.reservations.every((row) => normalized.vehicles.some((item) => item.vehicleId === row.vehicleId)), schedule.reservations.map((row) => row.vehicleId), "vehicle exists");
check("T0345", schedule.reservations.every((row) => tripPlan.trips.some((item) => item.tripId === row.tripId)), schedule.reservations.map((row) => row.tripId), "trip exists");
check("T0346", schedule.reservations.every((row) => DockWave.operationCompatible(normalized.docks.find((item) => item.dockId === row.dockId), row.operation)), schedule.reservations.map((row) => row.operation), "operation compatible");
check("T0347", DockWave.verifyDockSchedule(source, tripPlan, schedule).verifier === "INDEPENDENT_INTERVAL_SWEEP", DockWave.verifyDockSchedule(source, tripPlan, schedule), "independent overlap sweep");

const overlapRows = [{ startMinute: 100, endMinute: 120 }, { startMinute: 110, endMinute: 130 }, { startMinute: 115, endMinute: 125 }];
check("T0348", DockWave.verifyCapacity({ simultaneousCapacity: 1 }, overlapRows.slice(0, 2)).status === "FAIL", DockWave.verifyCapacity({ simultaneousCapacity: 1 }, overlapRows.slice(0, 2)), "capacity 1 overlap fails", true);
check("T0349", DockWave.verifyCapacity({ simultaneousCapacity: 2 }, overlapRows.slice(0, 2)).status === "PASS", DockWave.verifyCapacity({ simultaneousCapacity: 2 }, overlapRows.slice(0, 2)), "capacity 2 two overlap pass");
check("T0350", DockWave.verifyCapacity({ simultaneousCapacity: 2 }, overlapRows).status === "FAIL", DockWave.verifyCapacity({ simultaneousCapacity: 2 }, overlapRows), "capacity 2 three overlap fails", true);
const queueDock = { simultaneousCapacity: 1, queuePolicy: "FCFS" }; const queueTasks = [{ taskId: "A", desiredStart: 100, durationMinutes: 20, priority: 1, waveOrder: 2, appointmentMinute: 130 }, { taskId: "B", desiredStart: 105, durationMinutes: 10, priority: 10, waveOrder: 1, appointmentMinute: 105 }];
check("T0351", DockWave.scheduleQueue(queueTasks, queueDock, "FCFS")[0].taskId === "A", DockWave.scheduleQueue(queueTasks, queueDock, "FCFS"), "FCFS ordering");
check("T0352", DockWave.scheduleQueue(queueTasks, queueDock, "PRIORITY")[0].taskId === "B", DockWave.scheduleQueue(queueTasks, queueDock, "PRIORITY"), "priority ordering");
check("T0353", DockWave.scheduleQueue(queueTasks, queueDock, "WAVE_ORDER")[0].taskId === "B", DockWave.scheduleQueue(queueTasks, queueDock, "WAVE_ORDER"), "wave ordering");
check("T0354", DockWave.scheduleQueue(queueTasks, queueDock, "FIXED_APPOINTMENT")[0].taskId === "B" && DockWave.scheduleQueue(queueTasks, queueDock, "FIXED_APPOINTMENT")[0].startMinute === 105, DockWave.scheduleQueue(queueTasks, queueDock, "FIXED_APPOINTMENT"), "fixed appointment");
const queuedState = schedule.tripStates.find((row) => row.queueWaitMinutes > 0);
check("T0355", queuedState && queuedState.scheduledTripStart > tripPlan.trips.find((row) => row.tripId === queuedState.tripId).startMinute, queuedState, "queue enters trip start");
check("T0356", schedule.tripStates.some((row) => row.dutyQueueMinutes > 0), schedule.tripStates, "queue enters duty");
check("T0357", schedule.metrics.totalQueueCost > 0 && schedule.tripStates.some((row) => row.queueCost > 0), schedule.metrics, "queue enters cost");
check("T0358", schedule.alerts.some((row) => row.reasonCode === "DOCK_QUEUE_WAIT"), schedule.alerts, "queue alert");
check("T0359", DockWave.verifyCapacity({ simultaneousCapacity: 1 }, overlapRows.slice(0, 2)).reasonCode === "DOCK_CAPACITY_EXCEEDED", DockWave.verifyCapacity({ simultaneousCapacity: 1 }, overlapRows.slice(0, 2)), "conflict reason");
const unavailableSource = baseSource(2, 1); unavailableSource.docks.forEach((item) => { item.type = "UNLOAD"; }); const unavailableTrip = makePlan(unavailableSource, 2); const unavailableSchedule = DockWave.scheduleDocks(unavailableSource, unavailableTrip);
check("T0360", unavailableSchedule.unscheduled.some((row) => row.operation === "LOAD" && row.reasonCode === "DOCK_UNAVAILABLE"), unavailableSchedule.unscheduled, "dock unavailable scenario", true);
check("T0361", schedule.tripStates.every((row) => row.readyAfterLoad && row.scheduledTripStart > 0), schedule.tripStates, "trip ready after load");
check("T0362", schedule.tripStates.every((row) => row.terminalAfterUnload), schedule.tripStates, "trip terminal after unload");
check("T0363", tripPlan.reloadEvents.every((event) => schedule.reservations.some((row) => row.operation === "RELOAD" && row.tripId === event.tripIdAfter)), schedule.reservations.filter((row) => row.operation === "RELOAD"), "reload reservation chain");
const crossSource = makeNetwork({ depotCount: 2, vehicleCount: 2, orderCount: 2, pickupDelivery: true, crossDock: true }); crossSource.pickupDeliveryPairs[0].sameVehicleRequired = false; crossSource.pickupDeliveryPairs[0].sameTripRequired = false; const crossTrip = makePlan(crossSource, 2); const custody = Custody.planPickupDelivery(crossSource, { crossDock: true }); const crossSchedule = DockWave.scheduleDocks(crossSource, crossTrip, { custodyPlan: custody });
check("T0364", ["CROSS_DOCK_IN", "CROSS_DOCK_OUT"].every((operation) => crossSchedule.reservations.some((row) => row.operation === operation)) && DockWave.verifyDockSchedule(crossSource, crossTrip, crossSchedule, { custodyPlan: custody }).status === "PASS", crossSchedule.reservations.filter((row) => row.operation.startsWith("CROSS")), "cross-dock reservations");

const waves = DockWave.createWaves(source, tripPlan, schedule, { maxTripsPerWave: 2 }); const wave = waves.waves[0];
check("T0365", wave.waveId && wave.depotId && wave.releaseWindow && Number.isFinite(wave.cutoffMinute) && Array.isArray(wave.orderIds) && Array.isArray(wave.tripIds) && wave.status === "DRAFT", wave, "wave schema");
check("T0366", normalized.depots.some((depot) => depot.depotId === wave.depotId), wave.depotId, "wave depot exists");
check("T0367", wave.releaseWindow.startMinute <= wave.releaseWindow.endMinute, wave.releaseWindow, "release window valid");
check("T0368", Number.isFinite(wave.cutoffMinute) && /^\d\d:\d\d/.test(wave.cutoffTime), [wave.cutoffMinute, wave.cutoffTime], "cutoff explicit");
check("T0369", new Set(waves.waves.flatMap((row) => row.orderIds)).size === tripPlan.trips.flatMap((row) => row.orderIds).length, waves.metrics, "wave order conservation");
check("T0370", new Set(waves.waves.flatMap((row) => row.tripIds)).size === tripPlan.trips.length, waves.metrics, "wave trip conservation");
const frozen = DockWave.transitionWave(wave, "FROZEN");
check("T0371", frozen.status === "APPLIED" && frozen.wave.status === "FROZEN", frozen, "DRAFT to FROZEN");
const released = DockWave.transitionWave(frozen.wave, "RELEASED");
check("T0372", released.wave.status === "RELEASED", released, "FROZEN to RELEASED");
const loading = DockWave.transitionWave(released.wave, "LOADING");
check("T0373", loading.wave.status === "LOADING", loading, "RELEASED to LOADING");
const departed = DockWave.transitionWave(loading.wave, "DEPARTED");
check("T0374", departed.wave.status === "DEPARTED", departed, "LOADING to DEPARTED");
const completed = DockWave.transitionWave(departed.wave, "COMPLETED");
check("T0375", completed.wave.status === "COMPLETED", completed, "DEPARTED to COMPLETED");
check("T0376", DockWave.transitionWave(wave, "COMPLETED").status === "REJECTED" && DockWave.transitionWave(wave, "COMPLETED").reasonCode === "ILLEGAL_WAVE_TRANSITION", DockWave.transitionWave(wave, "COMPLETED"), "illegal transition rejected", true);
const revision = DockWave.reviseFrozenWave(frozen.wave, { orderIds: frozen.wave.orderIds.slice(0, 1) });
check("T0377", revision.status === "REVISION_CREATED" && revision.wave.revision === 2 && revision.wave.parentRevisionHash === frozen.wave.waveHash && revision.wave.status === "DRAFT", revision, "frozen mutation creates revision");
const cancelled = DockWave.transitionWave(wave, "CANCELLED");
check("T0378", cancelled.wave.status === "CANCELLED" && DockWave.transitionWave(cancelled.wave, "FROZEN").status === "REJECTED", cancelled, "cancelled terminal behavior");
const riskyWaves = DockWave.createWaves(source, tripPlan, schedule, { maxTripsPerWave: 2, cutoffMinute: 9999 });
check("T0379", riskyWaves.waves.every((row) => row.risks.some((risk) => risk.reasonCode === "WAVE_CUTOFF_RISK")), riskyWaves.waves.map((row) => row.risks), "cutoff risk");
check("T0380", waves.waves.some((row) => row.risks.some((risk) => risk.reasonCode === "LATE_LOADING_RISK")), waves.waves.map((row) => row.risks), "late loading risk");
check("T0381", schedule.metrics.congestionReservations > 0, schedule.metrics, "congestion metric");
check("T0382", schedule.metrics.maxQueueMinutes === Math.max(...schedule.reservations.map((row) => row.queueWaitMinutes)), schedule.metrics.maxQueueMinutes, "max queue metric");
check("T0383", Number.isFinite(schedule.metrics.averageQueueMinutes) && schedule.metrics.averageQueueMinutes >= 0, schedule.metrics.averageQueueMinutes, "average queue metric");
check("T0384", schedule.metrics.utilization > 0 && schedule.metrics.utilization <= 1, schedule.metrics.utilization, "utilization metric");
check("T0385", waves.metrics.serviceRate === 1, waves.metrics, "wave service metric");
check("T0386", schedule.dockScheduleHash === Contract.hashArtifact(DockWave.scheduleProjection(schedule)), schedule.dockScheduleHash, "dock schedule hash");
check("T0387", waves.waveScheduleHash === Contract.hashArtifact(DockWave.waveProjection(waves)), waves.waveScheduleHash, "wave schedule hash");
const metricTamper = clone(schedule); metricTamper.metrics.maxQueueMinutes += 1;
check("T0388", DockWave.verifyDockSchedule(source, tripPlan, metricTamper).issues.includes("DOCK_METRIC_MISMATCH"), DockWave.verifyDockSchedule(source, tripPlan, metricTamper).issues, "reported metrics tamper rejected", true);
check("T0389", DockWave.verifyDockSchedule(source, tripPlan, schedule).status === "PASS" && DockWave.verifyDockSchedule(source, tripPlan, schedule).verifier === "INDEPENDENT_INTERVAL_SWEEP", DockWave.verifyDockSchedule(source, tripPlan, schedule), "independent dock verifier");
check("T0390", DockWave.verifyWaveSchedule(source, tripPlan, schedule, waves).status === "PASS" && DockWave.verifyWaveSchedule(source, tripPlan, schedule, waves).verifier === "INDEPENDENT_WAVE_CONSERVATION", DockWave.verifyWaveSchedule(source, tripPlan, schedule, waves), "independent wave verifier");
const lanes = DockWave.ganttLanes(schedule);
check("T0391", lanes.length === new Set(schedule.reservations.map((row) => row.dockId)).size && lanes.every((lane) => lane.reservations.every((row) => row.lane >= 1)), lanes, "Gantt dock lanes");
const proposal = DockWave.proposeReschedule(source, tripPlan, schedule, reservation.reservationId, reservation.startMinute + 1);
check("T0392", proposal.status === "PROPOSAL" && proposal.committed === false && proposal.originalHash === schedule.dockScheduleHash && schedule.reservations[0].startMinute === reservation.startMinute, proposal, "drag is proposal only");
const invalidProposal = DockWave.proposeReschedule(source, tripPlan, schedule, reservation.reservationId, 10);
check("T0393", invalidProposal.action === "ROLLBACK_REQUIRED" && invalidProposal.verification.status === "FAIL", invalidProposal.verification, "invalid proposal rolls back", true);
const mobileProposal = DockWave.mobileReschedule(source, tripPlan, schedule, reservation.reservationId, "LATER");
check("T0394", mobileProposal.status === "PROPOSAL" && mobileProposal.proposal.reservations.find((row) => row.reservationId === reservation.reservationId).startMinute === reservation.startMinute + 15, mobileProposal.action, "mobile button reschedule");
const orderedReservations = [...schedule.reservations].sort((a, b) => a.startMinute - b.startMinute || Contract.utf8Compare(a.reservationId, b.reservationId));
check("T0395", DockWave.keyboardMove(schedule, orderedReservations[0].reservationId, "NEXT") === orderedReservations[1].reservationId, orderedReservations.slice(0, 2).map((row) => row.reservationId), "keyboard dock navigation");
check("T0396", DockWave.reservationTable(schedule).length === schedule.reservations.length && DockWave.reservationTable(schedule).every((row) => row.reservationId && row.dockId && row.tripId && row.operation), DockWave.reservationTable(schedule)[0], "No-WebGL reservation table");
check("T0397", DockWave.animationPolicy(true).animateQueue === false && DockWave.animationPolicy(true).meaningPreserved, DockWave.animationPolicy(true), "reduced motion lossless");

const twentyDockSource = baseSource(4, 2); twentyDockSource.docks = []; twentyDockSource.depots[0].dockIds = []; for (let index = 0; index < 20; index += 1) { const dockId = `DOCK-20-${String(index + 1).padStart(2, "0")}`; twentyDockSource.depots[0].dockIds.push(dockId); twentyDockSource.docks.push({ dockId, depotId: "D1", type: index % 2 ? "MIXED" : "LOAD", compatibleVehicleTypes: ["VT-DIESEL", "VT-EV"], operatingWindows: [{ start: "06:00", end: "23:59" }], simultaneousCapacity: 1, loadRate: 3, unloadRate: 4, fixedSetupMinutes: 5, queuePolicy: "FCFS" }); }
const twentyDockTrip = makePlan(twentyDockSource, 2); const twentyDockSchedule = DockWave.scheduleDocks(twentyDockSource, twentyDockTrip);
check("T0398", Contract.normalizeScenario(twentyDockSource).docks.length === 20 && DockWave.verifyDockSchedule(twentyDockSource, twentyDockTrip, twentyDockSchedule).status === "PASS", { docks: Contract.normalizeScenario(twentyDockSource).docks.length, reservations: twentyDockSchedule.reservations.length }, "20-dock fixture");
const twentyWaveSource = baseSource(20, 10); const twentyWaveTrip = makePlan(twentyWaveSource, 1); const twentyWaveDock = DockWave.scheduleDocks(twentyWaveSource, twentyWaveTrip); const twentyWaves = DockWave.createWaves(twentyWaveSource, twentyWaveTrip, twentyWaveDock, { maxTripsPerWave: 1 });
check("T0399", twentyWaveTrip.trips.length === 20 && twentyWaves.waves.length === 20 && DockWave.verifyWaveSchedule(twentyWaveSource, twentyWaveTrip, twentyWaveDock, twentyWaves).status === "PASS", twentyWaves.metrics, "20-wave fixture");
const hundredSource = baseSource(100, 50); hundredSource.docks.forEach((item) => { item.simultaneousCapacity = 50; }); const hundredTrip = makePlan(hundredSource, 1); const dockStarted = performance.now(); const hundredDock = DockWave.scheduleDocks(hundredSource, hundredTrip); const dockElapsed = performance.now() - dockStarted;
check("T0400", hundredTrip.trips.length === 100 && hundredDock.tripStates.length === 100 && DockWave.verifyDockSchedule(hundredSource, hundredTrip, hundredDock).status === "PASS", { trips: hundredTrip.trips.length, reservations: hundredDock.reservations.length, elapsedMs: dockElapsed }, "100-trip scheduling");
const overlapMutation = clone(schedule); const sameDock = overlapMutation.reservations.filter((row) => row.dockId === reservation.dockId).slice(0, 2); sameDock[1].startMinute = sameDock[0].startMinute; sameDock[1].endMinute = sameDock[0].endMinute;
check("T0401", DockWave.verifyDockSchedule(source, tripPlan, overlapMutation).issues.includes("DOCK_CAPACITY_EXCEEDED"), DockWave.verifyDockSchedule(source, tripPlan, overlapMutation).issues, "ignore-overlap mutation killed", true);
const cutoffMutation = clone(riskyWaves); cutoffMutation.waves[0].risks = cutoffMutation.waves[0].risks.filter((risk) => risk.reasonCode !== "WAVE_CUTOFF_RISK");
check("T0402", DockWave.verifyWaveSchedule(source, tripPlan, schedule, cutoffMutation).issues.includes("WAVE_CUTOFF_RISK_IGNORED"), DockWave.verifyWaveSchedule(source, tripPlan, schedule, cutoffMutation).issues, "ignore-cutoff mutation killed", true);
const capsule = DockWave.createCapsule(schedule, waves);
check("T0403", DockWave.replayCapsule(capsule).status === "EQUIVALENT", DockWave.replayCapsule(capsule), "dock schedule capsule replay");
check("T0404", Number.isFinite(dockElapsed) && dockElapsed >= 0, dockElapsed, "dock performance recorded");
check("T0405", ["zh", "en", "ja"].every((locale) => ["DOCK", "QUEUE", "WAVE", "CUTOFF_RISK", "CONFLICT"].every((code) => DockWave.term(code, locale) !== code)), ["zh", "en", "ja"].map((locale) => DockWave.term("WAVE", locale)), "Chinese English Japanese terms");
check("T0406", schedule.audit.length === schedule.reservations.length + schedule.unscheduled.length && schedule.audit.every((row) => row.taskId && row.tripId && row.disposition), schedule.audit, "complete dock audit");

assert.strictEqual(assertions.length, 75, "Gate 5 must contain exactly T0332-T0406");
process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, performanceMs: dockElapsed, metrics: schedule.metrics, scale: hundredDock.metrics, assertions }, null, 2)}\n`);
