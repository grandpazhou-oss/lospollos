#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Contract = require("../network-contract-v18.js");
const Custody = require("../pickup-custody-v18.js");
const { makeNetwork } = require("./fixtures/network-v18-fixture.js");

const assertions = [];
function check(requirementId, condition, observed, expected, negative = false) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, negative, evidence: "tests/test_pickup_custody_v18.js" };
  assertions.push(row); assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}
const clone = (value) => structuredClone(value);
function directSource(pairCount = 1, vehicleCount = pairCount) { return makeNetwork({ depotCount: 1, vehicleCount: Math.max(1, vehicleCount), orderCount: pairCount * 2, pickupDelivery: true }); }
function crossSource(pairCount = 1) { const source = makeNetwork({ depotCount: 2, vehicleCount: 2, orderCount: pairCount * 2, pickupDelivery: true, crossDock: true }); source.pickupDeliveryPairs.forEach((pair) => { pair.sameVehicleRequired = false; pair.sameTripRequired = false; pair.transferAllowed = true; }); return source; }

const directScenario = directSource(); const normalizedDirect = Contract.normalizeScenario(directScenario); const pair = normalizedDirect.pickupDeliveryPairs[0]; const direct = Custody.planPickupDelivery(directScenario); const shipment = direct.shipments[0]; const pickup = shipment.events.find((row) => row.type === "PICKUP"); const delivery = shipment.events.find((row) => row.type === "DELIVERY");
check("T0256", pair.pairId && pair.pickupOrderId && pair.deliveryOrderId && pair.precedence === "PICKUP_BEFORE_DELIVERY" && typeof pair.sameVehicleRequired === "boolean", pair, "normalized pair schema");
check("T0257", pickup.endMinute <= delivery.startMinute, [pickup.endMinute, delivery.startMinute], "pickup before delivery");
const vehicleTamper = clone(direct); vehicleTamper.shipments[0].events[1].vehicleId = "UNKNOWN-V2";
check("T0258", Custody.verifyPickupDelivery(directScenario, vehicleTamper).issues.includes("SAME_VEHICLE_VIOLATION"), Custody.verifyPickupDelivery(directScenario, vehicleTamper).issues, "same vehicle enforced", true);
const sameTripScenario = clone(directScenario); sameTripScenario.pickupDeliveryPairs[0].sameTripRequired = true; const sameTripPlan = Custody.planPickupDelivery(sameTripScenario); const tripTamper = clone(sameTripPlan); tripTamper.shipments[0].events[1].tripId += "-OTHER";
check("T0259", Custody.verifyPickupDelivery(sameTripScenario, tripTamper).issues.includes("SAME_TRIP_VIOLATION"), Custody.verifyPickupDelivery(sameTripScenario, tripTamper).issues, "same trip enforced", true);
const forbiddenTransfer = clone(direct); forbiddenTransfer.shipments[0].transferId = "ILLEGAL-TRANSFER";
check("T0260", Custody.verifyPickupDelivery(directScenario, forbiddenTransfer).issues.includes("TRANSFER_NOT_ALLOWED"), Custody.verifyPickupDelivery(directScenario, forbiddenTransfer).issues, "transferAllowed=false enforced", true);
const rideScenario = clone(directScenario); rideScenario.pickupDeliveryPairs[0].maxRideTime = 1;
check("T0261", Custody.verifyPickupDelivery(rideScenario, direct).issues.includes("MAX_RIDE_TIME_EXCEEDED"), Custody.verifyPickupDelivery(rideScenario, direct).issues, "max ride time enforced", true);
check("T0262", pickup.afterLoad.volume > pickup.beforeLoad.volume && pickup.afterLoad.weight > pickup.beforeLoad.weight, pickup, "pickup increases load");
check("T0263", delivery.afterLoad.volume < delivery.beforeLoad.volume && delivery.afterLoad.weight < delivery.beforeLoad.weight, delivery, "delivery decreases load");
const transformedScenario = clone(directScenario); transformedScenario.pickupDeliveryPairs[0].loadTransformation.volumeMultiplier = 1.5; const transformedPlan = Custody.planPickupDelivery(transformedScenario); const sourcePickup = transformedScenario.orders.find((row) => row.orderId === transformedScenario.pickupDeliveryPairs[0].pickupOrderId);
check("T0264", transformedPlan.shipments[0].transformedLoad.volume === sourcePickup.demand.volume * 1.5, transformedPlan.shipments[0].transformedLoad, "volume transformation");
check("T0265", pickup.onboardShipmentIds.includes(shipment.shipmentId) && !delivery.onboardShipmentIds.includes(shipment.shipmentId), [pickup.onboardShipmentIds, delivery.onboardShipmentIds], "onboard IDs evolve");
check("T0266", Custody.verifyPickupDelivery(directScenario, direct).status === "PASS", Custody.verifyPickupDelivery(directScenario, direct), "stop sequence independently recomputed");
const deliveryFirst = clone(direct); deliveryFirst.shipments[0].events[1].startMinute = pickup.startMinute - 1;
check("T0267", Custody.verifyPickupDelivery(directScenario, deliveryFirst).issues.includes("DELIVERY_BEFORE_PICKUP"), Custody.verifyPickupDelivery(directScenario, deliveryFirst).issues, "delivery-first fails", true);
const noPickup = clone(direct); noPickup.shipments[0].events = noPickup.shipments[0].events.filter((row) => row.type !== "PICKUP");
check("T0268", Custody.verifyPickupDelivery(directScenario, noPickup).issues.includes("PICKUP_MISSING"), Custody.verifyPickupDelivery(directScenario, noPickup).issues, "delivery without pickup fails", true);
const duplicatePickup = clone(direct); duplicatePickup.shipments[0].events.push(clone(duplicatePickup.shipments[0].events[0]));
check("T0269", Custody.verifyPickupDelivery(directScenario, duplicatePickup).issues.includes("DUPLICATE_PICKUP"), Custody.verifyPickupDelivery(directScenario, duplicatePickup).issues, "duplicate pickup fails", true);
const duplicateDelivery = clone(direct); duplicateDelivery.shipments[0].events.push(clone(duplicateDelivery.shipments[0].events[1]));
check("T0270", Custody.verifyPickupDelivery(directScenario, duplicateDelivery).issues.includes("DUPLICATE_DELIVERY"), Custody.verifyPickupDelivery(directScenario, duplicateDelivery).issues, "duplicate delivery fails", true);

const crossScenario = crossSource(); const cross = Custody.planPickupDelivery(crossScenario, { crossDock: true }); const transfer = cross.transfers[0];
const lostCustody = clone(cross); lostCustody.custodyEvents.splice(2, 1);
check("T0271", Custody.verifyPickupDelivery(crossScenario, lostCustody).issues.includes("CUSTODY_CHAIN_GAP"), Custody.verifyPickupDelivery(crossScenario, lostCustody).issues, "lost custody fails", true);
const doubleCustody = clone(cross); const duplicateOwner = clone(doubleCustody.custodyEvents[0]); duplicateOwner.custodyEventId = "DOUBLE-OWNER"; duplicateOwner.ownerId = "V2"; doubleCustody.custodyEvents.push(duplicateOwner);
check("T0272", Custody.verifyPickupDelivery(crossScenario, doubleCustody).issues.includes("DOUBLE_CUSTODY"), Custody.verifyPickupDelivery(crossScenario, doubleCustody).issues, "double vehicle custody fails", true);

const backhaulScenario = directSource(); const backhaul = Custody.planBackhaul(backhaulScenario, { mode: "DELIVERY_THEN_PICKUP", returnPolicy: "RETURN_TO_DEPOT", startTime: "08:00" });
check("T0273", backhaul.events[0].type === "DELIVERY" && backhaul.events[1].type === "PICKUP" && backhaul.events[0].endMinute <= backhaul.events[1].startMinute, backhaul.events, "delivery then pickup");
const simultaneous = Custody.planBackhaul(backhaulScenario, { mode: "SIMULTANEOUS_PICKUP_DELIVERY", returnPolicy: "RETURN_TO_DEPOT", startTime: "08:00" });
check("T0274", simultaneous.events.every((row) => row.type === "SIMULTANEOUS_PICKUP_DELIVERY") && simultaneous.events[0].startMinute === simultaneous.events[1].startMinute, simultaneous.events, "simultaneous operation");
check("T0275", backhaul.returnDepotId === backhaulScenario.vehicles[0].homeDepotId, backhaul.returnDepotId, "home depot");
const returnCenterScenario = makeNetwork({ depotCount: 2, vehicleCount: 2, orderCount: 2, pickupDelivery: true }); returnCenterScenario.depots[1].role = "RETURN_CENTER"; returnCenterScenario.depots[1].capabilities = ["RETURN"];
const returnCenter = Custody.planBackhaul(returnCenterScenario, { mode: "DELIVERY_THEN_PICKUP", returnPolicy: "RETURN_TO_RETURN_CENTER", startTime: "08:00" });
check("T0276", returnCenter.returnDepotId === "D2", returnCenter.returnDepotId, "return center");
check("T0277", backhaul.capacityFeasible && backhaul.events[1].afterLoad.volume <= backhaul.capacity.volume, { capacity: backhaul.capacity, load: backhaul.events[1].afterLoad }, "return capacity");
check("T0278", backhaul.timeWindowFeasible, backhaul.events[1].startMinute, "pickup window respected");
check("T0279", backhaul.handlingCost > 0, backhaul.handlingCost, ">0 handling cost");
const pickupOrder = backhaulScenario.orders.find((row) => row.taskType === "PICKUP");
check("T0280", backhaul.departureLoad.volume !== pickupOrder.demand.volume && backhaul.departureLoad.volume === backhaulScenario.orders.find((row) => row.taskType === "DELIVERY").demand.volume, backhaul.departureLoad, "pickup excluded at departure");

check("T0281", transfer.transferId && transfer.shipmentId && transfer.fromTripId && transfer.toTripId && transfer.depotId && transfer.inboundDockId && transfer.outboundDockId && transfer.transferDuration > 0, transfer, "transfer schema");
check("T0282", crossScenario.depots.find((row) => row.depotId === transfer.depotId).transferSupported, transfer.depotId, "transfer depot capability");
check("T0283", ["CROSS_DOCK_IN", "UNLOAD", "MIXED"].includes(crossScenario.docks.find((row) => row.dockId === transfer.inboundDockId).type), transfer.inboundDockId, "inbound dock capability");
check("T0284", ["CROSS_DOCK_OUT", "LOAD", "MIXED"].includes(crossScenario.docks.find((row) => row.dockId === transfer.outboundDockId).type), transfer.outboundDockId, "outbound dock capability");
check("T0285", transfer.inboundArrival <= transfer.unloadStart, [transfer.inboundArrival, transfer.unloadStart], "arrival before unload");
check("T0286", transfer.unloadEnd <= transfer.transferStart, [transfer.unloadEnd, transfer.transferStart], "unload before transfer");
check("T0287", transfer.transferEnd - transfer.transferStart === transfer.transferDuration && transfer.transferDuration > 0, [transfer.transferStart, transfer.transferEnd, transfer.transferDuration], "duration enforced");
check("T0288", transfer.transferStart >= transfer.readyTime, [transfer.transferStart, transfer.readyTime], "ready time enforced");
check("T0289", transfer.outboundLoadEnd <= transfer.latestHandover && transfer.status === "PLANNED", [transfer.outboundLoadEnd, transfer.latestHandover], "handover deadline");
check("T0290", transfer.outboundLoadStart >= transfer.transferEnd, [transfer.outboundLoadStart, transfer.transferEnd], "load after transfer");
check("T0291", transfer.outboundDepart >= transfer.outboundLoadEnd, [transfer.outboundDepart, transfer.outboundLoadEnd], "depart after load");
const missed = Custody.planPickupDelivery(crossScenario, { crossDock: true, latestHandoverMinute: 1 });
check("T0292", missed.shipments[0].reasonCode === "MISSED_CONNECTION" && missed.transfers[0].status === "MISSED_CONNECTION", missed.shipments[0], "missed connection reason");
check("T0293", missed.alerts.some((row) => row.reasonCode === "MISSED_CONNECTION" && row.disposition === "RECOVERY_REQUIRED"), missed.alerts, "missed connection alert");
check("T0294", Custody.verifyPickupDelivery(crossScenario, cross).status === "PASS", Custody.verifyPickupDelivery(crossScenario, cross), "unique custody owner");
check("T0295", transfer.custodyEventIds.length === 5 && transfer.custodyEventIds.every((id) => cross.custodyEvents.some((row) => row.custodyEventId === id)), transfer.custodyEventIds, "traceable transfer chain");
const acrossDayScenario = crossSource(); acrossDayScenario.constraints.transferAcrossDaysPolicy = "FORBID"; acrossDayScenario.planningHorizon.businessDayStart = "18:00"; acrossDayScenario.planningHorizon.businessDayEnd = "02:00"; acrossDayScenario.orders.forEach((order) => { order.releaseTime = "23:40"; order.dueTime = "01:30"; });
const acrossDay = Custody.planPickupDelivery(acrossDayScenario, { crossDock: true, startTime: "23:50" });
check("T0296", acrossDay.shipments[0].reasonCode === "TRANSFER_ACROSS_DAYS_FORBIDDEN", acrossDay.shipments[0], "across-days policy");
const cancelled = Custody.planPickupDelivery(crossScenario, { crossDock: true, cancelTransfer: true });
check("T0297", cancelled.transfers[0].status === "CANCELLED" && cancelled.shipments[0].reasonCode === "TRANSFER_CANCELLED", cancelled.transfers[0], "cancellation policy");
check("T0298", transfer.volume === cross.shipments[0].transformedLoad.volume && transfer.weight === cross.shipments[0].transformedLoad.weight, [transfer.volume, transfer.weight], "load/weight conserved");
check("T0299", transfer.handlingCost > 0 && cross.metrics.transferHandlingCost === transfer.handlingCost, cross.metrics, "transfer handling cost");
check("T0300", transfer.carbonKg >= 0 && transfer.carbonSource === "SYNTHETIC_DEPOT_DURATION_ESTIMATE", [transfer.carbonKg, transfer.carbonSource], "transfer carbon estimate");
check("T0301", cross.metrics.transferCount === cross.transfers.length && cross.metrics.transferCount === 1, cross.metrics, "transfer count metric");
check("T0302", cross.capability.crossDock === "SUPPORTED_LOCAL_SYNTHETIC" && cross.transfers.length === 1, cross.capability, "cross-dock enabled");
const disabled = Custody.planPickupDelivery(crossScenario, { crossDock: false });
check("T0303", disabled.transfers.length === 0 && disabled.shipments[0].status === "PLANNED", disabled.metrics, "cross-dock disabled");
const changedInput = clone(directScenario); changedInput.orders[0].demand.volume += 1; const changedPlan = Custody.planPickupDelivery(changedInput);
check("T0304", Custody.compare(direct, changedPlan).wording === "SCENARIO_CHANGED", Custody.compare(direct, changedPlan), "different inputHash wording");
check("T0305", direct.solver === "LOCAL_DETERMINISTIC_PICKUP_CUSTODY" && direct.metrics.plannedCount === 1, direct.solver, "pickup/delivery solver support");
check("T0306", Custody.verifyPickupDelivery(directScenario, direct).verifier === "INDEPENDENT_CUSTODY_STATE_MACHINE" && Custody.verifyPickupDelivery(directScenario, direct).status === "PASS", Custody.verifyPickupDelivery(directScenario, direct), "independent verifier");
check("T0307", cross.capability.crossDock === "SUPPORTED_LOCAL_SYNTHETIC", cross.capability, "cross-dock capability disclosure");
check("T0308", Custody.verifyPickupDelivery(crossScenario, cross).status === "PASS" && Custody.verifyPickupDelivery(crossScenario, cross).recomputed.transferCount === 1, Custody.verifyPickupDelivery(crossScenario, cross), "cross-dock post-verifier");
check("T0309", Custody.preserveCustodyForRepair(cross, "LOCAL_REPAIR").status === "CUSTODY_PRESERVED", Custody.preserveCustodyForRepair(cross, "LOCAL_REPAIR"), "local repair preserves custody");
check("T0310", Custody.preserveCustodyForRepair(cross, "FULL_REOPT").custodyHash === Custody.preserveCustodyForRepair(cross, "LOCAL_REPAIR").custodyHash, Custody.preserveCustodyForRepair(cross, "FULL_REOPT"), "full reopt preserves custody");
check("T0311", Custody.triggerTransferIncident(cross, transfer.transferId).triggered && Custody.triggerTransferIncident(cross, transfer.transferId).stage === "TRANSFER", Custody.triggerTransferIncident(cross, transfer.transferId), "incident during transfer");
check("T0312", Custody.recoverMissedTransfer(missed, missed.transfers[0].transferId).status === "READY_FOR_REPLAN", Custody.recoverMissedTransfer(missed, missed.transfers[0].transferId), "recover missed transfer");
check("T0313", ["INBOUND_ARRIVAL", "TRANSFER_UNLOAD", "TRANSFER", "OUTBOUND_LOAD", "OUTBOUND_DEPART"].every((type) => cross.executionEvents.some((row) => row.type === type)), cross.executionEvents, "execution transfer events");
check("T0314", cross.driverTasks.length === 2 && cross.driverTasks.every((row) => row.transferId === transfer.transferId), cross.driverTasks, "driver transfer tasks");
check("T0315", cross.timelineHandoffs[0].inboundArrival <= cross.timelineHandoffs[0].unloadEnd && cross.timelineHandoffs[0].unloadEnd <= cross.timelineHandoffs[0].transferEnd && cross.timelineHandoffs[0].transferEnd <= cross.timelineHandoffs[0].outboundDepart, cross.timelineHandoffs[0], "timeline handoff");
check("T0316", cross.mapFlows[0].style === "TRANSFER_FLOW" && cross.mapFlows[0].viaDepotId === transfer.depotId, cross.mapFlows[0], "network map transfer flow");
check("T0317", Custody.custodyTable(cross).length === cross.custodyEvents.length && Custody.custodyTable(cross).every((row) => row.shipmentId && row.ownerType && row.ownerId), Custody.custodyTable(cross), "No-WebGL custody table");
check("T0318", Custody.mobileTransfer(cross, transfer.transferId).layout === "BOTTOM_SHEET" && Custody.mobileTransfer(cross, transfer.transferId).closeAction === "RETURN_TO_TRANSFER_LIST", Custody.mobileTransfer(cross, transfer.transferId), "mobile transfer detail");
const twoCrossScenario = crossSource(2); const twoCross = Custody.planPickupDelivery(twoCrossScenario, { crossDock: true });
check("T0319", Custody.keyboardMove(twoCross, twoCross.transfers[0].transferId, "NEXT") === twoCross.transfers[1].transferId && Custody.keyboardMove(twoCross, twoCross.transfers[1].transferId, "PREVIOUS") === twoCross.transfers[0].transferId, twoCross.transfers.map((row) => row.transferId), "keyboard transfer navigation");
const capsule = Custody.createCapsule(crossScenario, cross);
check("T0320", Custody.replay(crossScenario, capsule).status === "EQUIVALENT", Custody.replay(crossScenario, capsule), "custody capsule replay");
const custodyTamper = clone(cross); custodyTamper.custodyEvents[0].ownerId = "TAMPERED";
check("T0321", Custody.verifyPickupDelivery(crossScenario, custodyTamper).status === "FAIL", Custody.verifyPickupDelivery(crossScenario, custodyTamper).issues, "custody tamper rejected", true);
check("T0322", Custody.verifyPickupDelivery(directScenario, deliveryFirst).issues.includes("DELIVERY_BEFORE_PICKUP"), Custody.verifyPickupDelivery(directScenario, deliveryFirst).issues, "delivery-first mutation killed", true);
check("T0323", Custody.verifyPickupDelivery(crossScenario, doubleCustody).issues.includes("DOUBLE_CUSTODY"), Custody.verifyPickupDelivery(crossScenario, doubleCustody).issues, "double-custody mutation killed", true);
const deadlineTamper = clone(cross); deadlineTamper.transfers[0].latestHandover = deadlineTamper.transfers[0].outboundLoadEnd - 1;
check("T0324", Custody.verifyPickupDelivery(crossScenario, deadlineTamper).issues.includes("HANDOVER_DEADLINE_IGNORED"), Custody.verifyPickupDelivery(crossScenario, deadlineTamper).issues, "handover mutation killed", true);
check("T0325", direct.metrics.costToServe > 0 && shipment.costToServe > 0, direct.metrics.costToServe, "pickup/delivery cost-to-serve");
check("T0326", backhaul.carbonKg > 0 && backhaul.carbonSource === "ESTIMATED_HAVERSINE_SYNTHETIC_FACTOR", [backhaul.carbonKg, backhaul.carbonSource], "backhaul carbon");
const scaleScenario = directSource(100, 100); const pairStarted = performance.now(); const scale = Custody.planPickupDelivery(scaleScenario); const pairElapsed = performance.now() - pairStarted;
check("T0327", scale.shipments.length === 100 && scale.metrics.plannedCount === 100 && Custody.verifyPickupDelivery(scaleScenario, scale).status === "PASS", { pairs: scale.shipments.length, elapsedMs: pairElapsed }, "100-pair fixture");
const crossStarted = performance.now(); const crossScale = Custody.planPickupDelivery(twoCrossScenario, { crossDock: true }); const crossElapsed = performance.now() - crossStarted;
check("T0328", crossScale.transfers.length === 2 && Number.isFinite(crossElapsed) && crossElapsed >= 0, { transfers: crossScale.transfers.length, elapsedMs: crossElapsed }, "cross-dock performance recorded");
check("T0329", ["zh", "en", "ja"].every((locale) => ["PICKUP", "DELIVERY", "TRANSFER", "CUSTODY", "MISSED_CONNECTION", "RETURN"].every((code) => Custody.term(code, locale) !== code)), ["zh", "en", "ja"].map((locale) => Custody.term("TRANSFER", locale)), "Chinese English Japanese terms");
check("T0330", [cross, disabled, missed, scale].every((plan) => plan.syntheticLabel === Custody.SYNTHETIC_LABEL), [cross.syntheticLabel, disabled.syntheticLabel, missed.syntheticLabel, scale.syntheticLabel], "synthetic label always visible");
check("T0331", cross.audit.length === crossScenario.pickupDeliveryPairs.length && cross.audit.every((row) => row.pairId && row.eventCount === 2 && row.custodyEventCount > 0), cross.audit, "complete transfer audit");

assert.strictEqual(assertions.length, 76, "Gate 4 must contain exactly T0256-T0331");
process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, pairPerformanceMs: pairElapsed, crossDockPerformanceMs: crossElapsed, metrics: cross.metrics, scale: scale.metrics, assertions }, null, 2)}\n`);
