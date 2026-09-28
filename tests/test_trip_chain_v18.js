#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Contract = require("../network-contract-v18.js");
const Trip = require("../trip-chain-v18.js");
const { makeNetwork } = require("./fixtures/network-v18-fixture.js");

const assertions = [];
function check(requirementId, condition, observed, expected, negative = false) {
  const row = { assertionId: `${requirementId}-A1`, requirementId, status: condition ? "PASS" : "FAIL", observed, expected, negative, evidence: "tests/test_trip_chain_v18.js" };
  assertions.push(row); assert(condition, `${requirementId}: ${JSON.stringify({ observed, expected })}`);
}
const clone = (value) => structuredClone(value);
function oneDepot(orderCount = 6, vehicleCount = 1) { return makeNetwork({ depotCount: 1, vehicleCount, orderCount }); }
function threeTripScenario() { const source = oneDepot(6, 1); source.constraints.maxTripsPerVehicle = 3; source.vehicles[0].maxTrips = 3; return source; }
function planThree(source = threeTripScenario()) { return Trip.planTrips(source, { maxStopsPerTrip: 2, startTime: "08:00" }); }
function breakScenario(policy = "ANY_STOP") { const source = threeTripScenario(); const required = source.drivers[0].requiredBreaks[0]; required.triggerDrivingMinutes = 10; required.earliestStart = "06:00"; required.latestStart = "20:00"; required.locationPolicy = policy; if (policy === "REST_AREA_FIXTURE") source.constraints.restAreaFixtures = [{ restAreaId: "REST-TJ-01", coordinate: [117.15, 39.1] }]; return source; }

const limited = oneDepot(4, 1); limited.vehicles[0].maxTrips = 1; limited.constraints.maxTripsPerVehicle = 1;
const limitedPlan = Trip.planTrips(limited, { maxStopsPerTrip: 1, startTime: "08:00" });
check("T0185", limitedPlan.trips.length === 1 && limitedPlan.unassigned.filter((row) => row.reasonCode === "MAX_TRIPS_EXCEEDED").length === 3, { trips: limitedPlan.trips.length, unassigned: limitedPlan.unassigned }, "maxTrips=1 enforced");

const threeSource = threeTripScenario(); const three = planThree(threeSource); const chain = three.tripChains[0]; const chainTrips = chain.tripIds.map((id) => three.trips.find((trip) => trip.tripId === id));
check("T0186", chainTrips.every((trip, index) => trip.tripIndex === index + 1), chainTrips.map((trip) => trip.tripIndex), [1, 2, 3]);
check("T0187", chainTrips.every((trip, index) => trip.predecessorTripId === (index ? chainTrips[index - 1].tripId : "") && trip.successorTripId === (index + 1 < chainTrips.length ? chainTrips[index + 1].tripId : "")), chainTrips.map((trip) => [trip.predecessorTripId, trip.successorTripId]), "bidirectional links");
check("T0188", chainTrips.every((trip, index) => !index || chainTrips[index - 1].endMinute <= trip.startMinute), chainTrips.map((trip) => [trip.startMinute, trip.endMinute]), "non-overlap");
check("T0189", chainTrips.every((trip) => trip.physicalVehicleId === trip.vehicleId && trip.virtualVehicle === false), chainTrips.map((trip) => [trip.vehicleId, trip.physicalVehicleId, trip.virtualVehicle]), "physical vehicle identity");
check("T0190", chainTrips.every((trip) => threeSource.depots.some((depot) => depot.depotId === trip.startDepotId) && threeSource.depots.some((depot) => depot.depotId === trip.endDepotId)), chainTrips.map((trip) => [trip.startDepotId, trip.endDepotId]), "known depots");
check("T0191", chainTrips.every((trip) => trip.startMinute < trip.endMinute && /^\d\d:\d\d/.test(trip.startTime)), chainTrips.map((trip) => [trip.startTime, trip.endTime]), "valid trip times");

const repositionSource = makeNetwork({ depotCount: 2, vehicleCount: 2, orderCount: 4 }); repositionSource.vehicles[0].allowedStartDepotIds = ["D1", "D2"]; repositionSource.vehicles[0].maxTrips = 4; repositionSource.constraints.maxTripsPerVehicle = 4;
const reposition = Trip.planTrips(repositionSource, { maxStopsPerTrip: 1, vehicleIds: ["V1"], startTime: "08:00" });
check("T0192", Trip.verifyTripPlan(repositionSource, reposition).status === "PASS", Trip.verifyTripPlan(repositionSource, reposition), "continuous chain with explicit reposition");
check("T0193", reposition.repositionLegs.length >= 1, reposition.repositionLegs, "reposition generated");
check("T0194", reposition.metrics.repositionDistanceKm === Number(reposition.repositionLegs.reduce((sum, row) => sum + row.distanceKm, 0).toFixed(3)) && reposition.metrics.repositionDistanceKm > 0, reposition.metrics, "distance included");
check("T0195", reposition.metrics.repositionMinutes === reposition.repositionLegs.reduce((sum, row) => sum + row.durationMinutes, 0), reposition.metrics, "time included");
check("T0196", reposition.metrics.repositionCost === Number(reposition.repositionLegs.reduce((sum, row) => sum + row.cost, 0).toFixed(3)), reposition.metrics, "cost included");
check("T0197", reposition.metrics.repositionCarbonKg === Number(reposition.repositionLegs.reduce((sum, row) => sum + row.carbonKg, 0).toFixed(3)), reposition.metrics, "carbon included");
check("T0198", three.trips.every((trip) => trip.routeId && three.routes.some((route) => route.routeId === trip.routeId)), three.trips.map((trip) => trip.routeId), "route IDs exist");
check("T0199", three.trips.every((trip) => trip.loadEventId && trip.unloadEventId && (trip.tripIndex === 1 || trip.reloadEventId)), three.trips.map((trip) => [trip.loadEventId, trip.unloadEventId, trip.reloadEventId]), "load unload reload events");
check("T0200", three.reloadEvents.every((event) => threeSource.depots.find((depot) => depot.depotId === event.depotId)?.reloadSupported), three.reloadEvents, "reload-supported depot");
check("T0201", three.reloadEvents.every((event) => event.durationMinutes > 0 && event.endMinute > event.startMinute), three.reloadEvents.map((event) => event.durationMinutes), ">0");
check("T0202", three.reloadEvents.every((event) => event.volume >= 0 && event.weight >= 0), three.reloadEvents.map((event) => [event.volume, event.weight]), "non-negative load");
check("T0203", three.reloadEvents.every((event) => three.dockReservations.some((row) => row.reservationId === event.dockReservationId && row.tripId === event.tripIdAfter)), three.dockReservations, "reservation entity exists");
check("T0204", three.reloadEvents.every((event) => event.capacityReset.volume === event.volume && event.capacityReset.weight === event.weight), three.reloadEvents.map((event) => event.capacityReset), "capacity reset equals next load");
check("T0205", chainTrips.slice(1).every((trip, index) => chainTrips[index].endMinute <= trip.startMinute), chainTrips.map((trip) => [trip.startMinute, trip.endMinute]), "predecessor completes first");
check("T0206", three.trips.every((trip) => trip.orderIds.every((id) => trip.startMinute >= Trip.absoluteMinute(threeSource.orders.find((order) => order.orderId === id).releaseTime, Contract.normalizeScenario(threeSource)))), three.trips.map((trip) => trip.startMinute), "release time enforced");

const overlap = clone(three); overlap.trips[1].startMinute = overlap.trips[0].endMinute - 1;
check("T0207", Trip.verifyTripPlan(threeSource, overlap).issues.includes("DRIVER_SHIFT_OVERLAP"), Trip.verifyTripPlan(threeSource, overlap).issues, "driver overlap rejected", true);
const incompatible = clone(threeSource); incompatible.drivers[0].compatibleVehicleTypes = [];
check("T0208", Trip.verifyTripPlan(incompatible, three).issues.includes("DRIVER_VEHICLE_INCOMPATIBLE"), Trip.verifyTripPlan(incompatible, three).issues, "compatibility enforced", true);
const missingSkill = clone(threeSource); missingSkill.orders[0].requiredSkills = ["HAZMAT"];
check("T0209", Trip.verifyTripPlan(missingSkill, three).issues.includes("DRIVER_SKILL_MISSING"), Trip.verifyTripPlan(missingSkill, three).issues, "skill enforced", true);
const shortDuty = clone(threeSource); shortDuty.drivers[0].maxDutyMinutes = 10;
check("T0210", Trip.verifyTripPlan(shortDuty, three).issues.includes("DRIVER_DUTY_LIMIT"), Trip.verifyTripPlan(shortDuty, three).issues, "duty enforced", true);
const shortDriving = clone(threeSource); shortDriving.drivers[0].maxDrivingMinutes = 1;
check("T0211", Trip.verifyTripPlan(shortDriving, three).issues.includes("DRIVER_DRIVING_LIMIT"), Trip.verifyTripPlan(shortDriving, three).issues, "driving enforced", true);

const breakSource = breakScenario(); const breakPlan = planThree(breakSource); const breakEvent = breakPlan.breakEvents[0];
check("T0212", breakPlan.breakEvents.length === 1, breakPlan.breakEvents, "required break triggered");
check("T0213", breakEvent.durationMinutes === breakSource.drivers[0].requiredBreaks[0].duration, breakEvent.durationMinutes, breakSource.drivers[0].requiredBreaks[0].duration);
check("T0214", breakEvent.startMinute >= Trip.absoluteMinute("06:00", Contract.normalizeScenario(breakSource)) && breakEvent.startMinute <= Trip.absoluteMinute("20:00", Contract.normalizeScenario(breakSource)), breakEvent.startMinute, "inside window");
check("T0215", breakEvent.locationPolicy === "ANY_STOP" && breakEvent.locationId === "D1", breakEvent, "location policy enforced");
const changedBreak = clone(breakSource); changedBreak.drivers[0].requiredBreaks[0].duration += 1;
check("T0216", Contract.identityBundle(breakSource).networkInputHash !== Contract.identityBundle(changedBreak).networkInputHash, [Contract.identityBundle(breakSource).networkInputHash, Contract.identityBundle(changedBreak).networkInputHash], "break enters input hash");
check("T0217", breakEvent.solverApplied === true, breakEvent.solverApplied, true);
check("T0218", Trip.verifyTripPlan(breakSource, breakPlan).status === "PASS", Trip.verifyTripPlan(breakSource, breakPlan), "verifier checks break");
check("T0219", breakPlan.timelineEvents.some((row) => row.eventId === breakEvent.eventId), breakPlan.timelineEvents.filter((row) => row.kind === "BREAK"), "timeline includes break");
check("T0220", breakPlan.executionEvents.some((row) => row.eventId === breakEvent.eventId && row.executionStatus === "PLANNED"), breakPlan.executionEvents.filter((row) => row.kind === "BREAK"), "execution includes break");
check("T0221", breakPlan.explanations.some((row) => row.subjectId === breakEvent.breakId), breakPlan.explanations, "explainability includes break");
const missingBreakPlan = clone(breakPlan); missingBreakPlan.breakEvents = []; missingBreakPlan.timelineEvents = missingBreakPlan.timelineEvents.filter((row) => row.kind !== "BREAK"); missingBreakPlan.executionEvents = missingBreakPlan.executionEvents.filter((row) => row.kind !== "BREAK");
check("T0222", Trip.verifyTripPlan(breakSource, missingBreakPlan).issues.includes("REQUIRED_BREAK_MISSING"), Trip.verifyTripPlan(breakSource, missingBreakPlan).issues, "missing break fails", true);
const serviceOverlap = clone(breakPlan); const service = serviceOverlap.timelineEvents.find((row) => row.kind === "SERVICE"); Object.assign(serviceOverlap.breakEvents[0], { startMinute: service.startMinute, endMinute: service.startMinute + serviceOverlap.breakEvents[0].durationMinutes });
check("T0223", Trip.verifyTripPlan(breakSource, serviceOverlap).issues.includes("BREAK_ACTIVITY_OVERLAP"), Trip.verifyTripPlan(breakSource, serviceOverlap).issues, "service overlap fails", true);
const driveOverlap = clone(breakPlan); const drive = driveOverlap.timelineEvents.find((row) => row.kind === "DRIVE"); Object.assign(driveOverlap.breakEvents[0], { startMinute: drive.startMinute, endMinute: drive.startMinute + driveOverlap.breakEvents[0].durationMinutes });
check("T0224", Trip.verifyTripPlan(breakSource, driveOverlap).issues.includes("BREAK_ACTIVITY_OVERLAP"), Trip.verifyTripPlan(breakSource, driveOverlap).issues, "drive overlap fails", true);
const depotBreakSource = breakScenario("DEPOT_ONLY"); const depotBreakPlan = planThree(depotBreakSource);
check("T0225", depotBreakPlan.breakEvents[0].locationType === "DEPOT" && depotBreakPlan.breakEvents[0].locationId === "D1", depotBreakPlan.breakEvents[0], "depot-only location");
const restBreakSource = breakScenario("REST_AREA_FIXTURE"); const restBreakPlan = planThree(restBreakSource);
check("T0226", restBreakPlan.breakEvents[0].locationType === "REST_AREA_FIXTURE" && restBreakPlan.breakEvents[0].locationId === "REST-TJ-01", restBreakPlan.breakEvents[0], "rest fixture location");

const overnight = oneDepot(1, 1); overnight.planningHorizon.businessDayStart = "18:00"; overnight.planningHorizon.businessDayEnd = "02:00"; overnight.depots[0].operatingWindows = [{ start: "18:00", end: "02:00" }]; overnight.vehicles[0].availabilityWindows = [{ start: "18:00", end: "02:00" }]; overnight.drivers[0].shiftWindows = [{ start: "18:00", end: "02:00" }]; overnight.orders[0].timeWindows = [{ start: "18:00", end: "02:00" }]; overnight.orders[0].releaseTime = "23:40"; overnight.orders[0].dueTime = "01:30";
const overnightPlan = Trip.planTrips(overnight, { maxStopsPerTrip: 1, startTime: "23:50" });
check("T0227", overnightPlan.trips.length === 1 && overnightPlan.trips[0].endTime.includes("+1") && Trip.verifyTripPlan(overnight, overnightPlan).status === "PASS", overnightPlan.trips[0], "cross-midnight shift");
const multiDay = oneDepot(1, 1); multiDay.drivers[0].shiftWindows.push({ start: "06:00", end: "23:59" }); multiDay.vehicles[0].availabilityWindows.push({ start: "06:00", end: "23:59" });
const dayTwoPlan = Trip.planTrips(multiDay, { maxStopsPerTrip: 1, startTime: "08:00", dayOffset: 1 });
check("T0228", dayTwoPlan.trips.length === 1 && dayTwoPlan.trips[0].startMinute >= 1440 && Trip.verifyTripPlan(multiDay, dayTwoPlan).status === "PASS", dayTwoPlan.trips[0], "day-two availability");
const swapped = oneDepot(1, 2); swapped.drivers[0].compatibleVehicleTypes = ["VT-DIESEL"];
const swappedPlan = Trip.planTrips(swapped, { maxStopsPerTrip: 1, vehicleIds: ["V1"] });
check("T0229", swappedPlan.trips[0].vehicleId === "V1" && swappedPlan.trips[0].driverId === "DR2", swappedPlan.trips[0], "compatible driver can swap");
const fixedPair = oneDepot(1, 2); fixedPair.constraints.fixedDriverVehiclePairs = [{ vehicleId: "V1", driverId: "DR2" }];
const fixedPairPlan = Trip.planTrips(fixedPair, { maxStopsPerTrip: 1, vehicleIds: ["V1"] });
check("T0230", fixedPairPlan.trips[0].driverId === "DR2" && Trip.verifyTripPlan(fixedPair, fixedPairPlan).status === "PASS", fixedPairPlan.trips[0], "fixed pair enforced");
const maintenance = oneDepot(1, 1); maintenance.constraints.vehicleMaintenanceWindows = [{ vehicleId: "V1", start: "06:00", end: "23:00" }];
const maintenancePlan = Trip.planTrips(maintenance, { maxStopsPerTrip: 1, startTime: "08:00" });
check("T0231", maintenancePlan.trips.length === 0 && maintenancePlan.unassigned[0].reasonCode === "VEHICLE_UNAVAILABLE", maintenancePlan.unassigned, "maintenance window enforced", true);
const unavailable = oneDepot(1, 1); unavailable.vehicles[0].availabilityWindows = [];
const unavailablePlan = Trip.planTrips(unavailable, { maxStopsPerTrip: 1 });
check("T0232", unavailablePlan.trips.length === 0 && unavailablePlan.unassigned.length === 1 && unavailablePlan.unassigned[0].orderId === unavailable.orders[0].orderId && unavailablePlan.unassigned[0].reasonCode === "REQUIRED_VEHICLE_UNAVAILABLE" && unavailablePlan.unassigned[0].stage === "DEPOT_ASSIGNMENT", unavailablePlan.unassigned, "unavailable vehicle excluded", true);
const emptyTrip = clone(three); emptyTrip.trips[0].orderIds = [];
check("T0233", Trip.verifyTripPlan(threeSource, emptyTrip).issues.includes("EMPTY_TRIP"), Trip.verifyTripPlan(threeSource, emptyTrip).issues, "empty trip rejected", true);
const noStop = clone(three); noStop.routes[0].stops = [];
check("T0234", Trip.verifyTripPlan(threeSource, noStop).issues.includes("TRIP_BUSINESS_STOP_MISSING"), Trip.verifyTripPlan(threeSource, noStop).issues, "business stop required", true);
check("T0235", reposition.repositionLegs.every((leg) => leg.kind === "EMPTY_REPOSITION"), reposition.repositionLegs.map((leg) => leg.kind), "explicit reposition-only marker");
check("T0236", chain.tripChainHash === Contract.hashArtifact(Trip.chainProjection(three, chain.vehicleId)), chain.tripChainHash, "independently recomputed chain hash");
const tripOverlap = clone(three); tripOverlap.trips[1].startMinute = tripOverlap.trips[0].endMinute - 5;
check("T0237", Trip.verifyTripPlan(threeSource, tripOverlap).issues.includes("VEHICLE_TRIP_OVERLAP"), Trip.verifyTripPlan(threeSource, tripOverlap).issues, "overlap tamper rejected", true);
const timeTamper = clone(three); timeTamper.trips[0].endMinute = timeTamper.trips[0].startMinute;
check("T0238", Trip.verifyTripPlan(threeSource, timeTamper).issues.includes("TRIP_TIME_INVALID") && Trip.verifyTripPlan(threeSource, timeTamper).issues.includes("NETWORK_PLAN_HASH_MISMATCH"), Trip.verifyTripPlan(threeSource, timeTamper).issues, "time tamper rejected", true);
const breakTamper = clone(breakPlan); breakTamper.breakEvents[0].durationMinutes = 0;
check("T0239", Trip.verifyTripPlan(breakSource, breakTamper).issues.includes("BREAK_DURATION_INVALID"), Trip.verifyTripPlan(breakSource, breakTamper).issues, "break tamper rejected", true);
const rows = Trip.tripChainRows(three, "V1");
check("T0240", rows.length === 3 && rows.every((row) => row.vehicleId === "V1" && row.status === "PLANNED"), rows, "per-vehicle UI rows");
check("T0241", Trip.keyboardMove(three, "V1", rows[0].tripId, "NEXT") === rows[1].tripId && Trip.keyboardMove(three, "V1", rows[1].tripId, "PREVIOUS") === rows[0].tripId, rows.map((row) => row.tripId), "keyboard navigation");
check("T0242", Trip.mobileChain(three, "V1").layout === "BOTTOM_SHEET" && Trip.mobileChain(three, "V1").closeAction === "RETURN_TO_CHAIN", Trip.mobileChain(three, "V1"), "mobile representation");
check("T0243", rows.every((row) => row.tripId && row.startTime && row.endTime && row.orderCount > 0), rows, "complete No-WebGL table");
check("T0244", Trip.animationPolicy(true).animateVehicle === false && Trip.animationPolicy(true).meaningPreserved, Trip.animationPolicy(true), "reduced motion preserves meaning");
check("T0245", three.trips.length === 3 && three.tripChains[0].tripIds.length === 3, three.tripChains, "three-trip fixture");
const scaleSource = oneDepot(100, 50); scaleSource.depots[0].capacity.volume = 100000; scaleSource.depots[0].capacity.weight = 100000; const scaleStarted = performance.now(); const scalePlan = Trip.planTrips(scaleSource, { maxStopsPerTrip: 1, startTime: "08:00" }); const scaleElapsed = performance.now() - scaleStarted;
check("T0246", scalePlan.trips.length === 100 && scalePlan.tripChains.length === 50 && Trip.verifyTripPlan(scaleSource, scalePlan).status === "PASS", { trips: scalePlan.trips.length, vehicles: scalePlan.tripChains.length, elapsedMs: scaleElapsed }, "50 vehicles / 100 trips");
const singleSource = oneDepot(3, 1); const singlePlan = Trip.planTrips(singleSource, { maxStopsPerTrip: 10 });
check("T0247", singlePlan.trips.length === 1 && Trip.verifyTripPlan(singleSource, singlePlan).status === "PASS", singlePlan.metrics, "single-trip regression");
check("T0248", three.metrics.assignedOrders + three.metrics.unassignedOrders === threeSource.orders.length && new Set(three.trips.flatMap((trip) => trip.orderIds)).size === three.metrics.assignedOrders, three.metrics, "multi-trip conservation");
const capsule = Trip.createCapsule(threeSource, three);
check("T0249", Trip.replay(threeSource, capsule).status === "EQUIVALENT", Trip.replay(threeSource, capsule), "capsule replay");
const allowOverlapMutation = clone(three); allowOverlapMutation.trips[1].startMinute = allowOverlapMutation.trips[0].startMinute;
check("T0250", Trip.verifyTripPlan(threeSource, allowOverlapMutation).status === "FAIL" && Trip.verifyTripPlan(threeSource, allowOverlapMutation).issues.includes("VEHICLE_TRIP_OVERLAP"), Trip.verifyTripPlan(threeSource, allowOverlapMutation).issues, "overlap mutation killed", true);
const ignoreReload = clone(three); ignoreReload.reloadEvents[0].durationMinutes = 0; ignoreReload.reloadEvents[0].endMinute = ignoreReload.reloadEvents[0].startMinute;
check("T0251", Trip.verifyTripPlan(threeSource, ignoreReload).issues.includes("RELOAD_DURATION_INVALID"), Trip.verifyTripPlan(threeSource, ignoreReload).issues, "reload-time mutation killed", true);
check("T0252", Trip.verifyTripPlan(breakSource, missingBreakPlan).issues.includes("REQUIRED_BREAK_MISSING"), Trip.verifyTripPlan(breakSource, missingBreakPlan).issues, "ignore-break mutation killed", true);
check("T0253", Number.isFinite(scaleElapsed) && scaleElapsed >= 0, scaleElapsed, "measured milliseconds");
check("T0254", three.driverDutyAudit.length === three.tripChains.length && three.driverDutyAudit.every((row) => row.status === "PASS" && row.dutyMinutes >= row.drivingMinutes), three.driverDutyAudit, "complete driver duty audit");
check("T0255", three.dispositions.length === threeSource.orders.length && new Set(three.dispositions.map((row) => row.orderId)).size === threeSource.orders.length && three.dispositions.every((row) => ["PLANNED", "UNASSIGNED", "BLOCKED"].includes(row.disposition)), three.dispositions, "complete trip disposition");

assert.strictEqual(assertions.length, 71, "Gate 3 must contain exactly T0185-T0255");
process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, performanceMs: scaleElapsed, metrics: three.metrics, scale: scalePlan.metrics, assertions }, null, 2)}\n`);
