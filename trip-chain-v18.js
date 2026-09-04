(function (root, factory) {
  "use strict";
  const contract = typeof module !== "undefined" && module.exports ? require("./network-contract-v18.js") : root.STCTV18?.networkContract;
  const assignment = typeof module !== "undefined" && module.exports ? require("./depot-assignment-v18.js") : root.STCTV18?.depotAssignment;
  const api = factory(contract, assignment);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV18 = root.STCTV18 || { version: "1.8.0" }; root.STCTV18.tripChain = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Contract, Assignment) {
  "use strict";

  if (!Contract?.normalizeScenario || !Assignment?.assignDepots) throw new Error("STCT v1.8 network and assignment modules are required.");
  const VERSION = "stct-trip-chain-v1.8";
  const EARTH_KM = 6371.0088;
  const REASONS = Object.freeze({
    MAX_TRIPS_EXCEEDED: { zh: "车辆最大趟数已用尽", en: "Vehicle maximum trips exhausted", ja: "車両の最大トリップ数を超過" },
    VEHICLE_UNAVAILABLE: { zh: "车辆不可用", en: "Vehicle unavailable", ja: "車両利用不可" },
    DRIVER_UNAVAILABLE: { zh: "没有满足班次与技能的司机", en: "No driver satisfies shift and skill constraints", ja: "シフトとスキルを満たすドライバーなし" },
    RELOAD_UNAVAILABLE: { zh: "重装仓或装卸口不可用", en: "Reload depot or dock unavailable", ja: "再積込デポまたはドック利用不可" },
    BREAK_UNAVAILABLE: { zh: "无法在规定窗口执行休息", en: "Required break cannot be scheduled", ja: "必要休憩を指定時間内に設定不可" },
    DUTY_LIMIT_EXCEEDED: { zh: "司机工时上限超出", en: "Driver duty limit exceeded", ja: "ドライバー勤務上限超過" },
    DRIVING_LIMIT_EXCEEDED: { zh: "司机驾驶时长上限超出", en: "Driver driving limit exceeded", ja: "ドライバー運転上限超過" },
  });

  const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const round = (value) => Math.round(Number(value) * 1000) / 1000;
  const asNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const text = (value) => String(value ?? "");
  function reasonText(code, locale = "en") { const language = text(locale).startsWith("zh") ? "zh" : text(locale).startsWith("ja") ? "ja" : "en"; return REASONS[code]?.[language] || code; }
  function clockMinute(value) { const [hour, minute] = text(value).split(":").map(Number); return hour * 60 + minute; }
  function absoluteMinute(value, scenario, dayOffset = 0) {
    const minute = clockMinute(value); const start = clockMinute(scenario.planningHorizon.businessDayStart);
    return minute + (minute < start && scenario.planningHorizon.crossMidnightPolicy !== "FORBID" ? 1440 : 0) + dayOffset * 1440;
  }
  function windowBounds(window, scenario, dayOffset = 0) {
    const start = absoluteMinute(window.start, scenario, dayOffset); let end = absoluteMinute(window.end, scenario, dayOffset);
    if (end <= start) end += 1440;
    return [start, end];
  }
  function formatMinute(value) { const day = Math.floor(value / 1440); const minute = ((value % 1440) + 1440) % 1440; return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}${day ? `+${day}` : ""}`; }
  function radians(value) { return Number(value) * Math.PI / 180; }
  function distanceKm(left, right) {
    const latitude = radians(right[1] - left[1]); const longitude = radians(right[0] - left[0]);
    const a = Math.sin(latitude / 2) ** 2 + Math.cos(radians(left[1])) * Math.cos(radians(right[1])) * Math.sin(longitude / 2) ** 2;
    return round(2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a))));
  }
  function intervalOverlaps(leftStart, leftEnd, rightStart, rightEnd) { return Math.max(leftStart, rightStart) < Math.min(leftEnd, rightEnd); }
  function covers(windows, start, end, scenario, dayOffset = 0) { return windows.some((window) => { const bounds = windowBounds(window, scenario, dayOffset); return start >= bounds[0] && end <= bounds[1]; }); }
  function maintenanceConflict(scenario, vehicleId, start, end, dayOffset = 0) { return (scenario.constraints.vehicleMaintenanceWindows || []).some((window) => { if (window.vehicleId !== vehicleId) return false; const bounds = windowBounds(window, scenario, dayOffset); return intervalOverlaps(start, end, bounds[0], bounds[1]); }); }
  function capacityOf(vehicle, type) { return { volume: asNumber(vehicle.capacity?.volume, asNumber(type?.capacity?.volume, Infinity)), weight: asNumber(vehicle.capacity?.weight, asNumber(type?.capacity?.weight, Infinity)) }; }
  function orderLoad(order) { return { volume: asNumber(order.demand?.volume), weight: asNumber(order.demand?.weight) }; }
  function addLoad(left, right) { return { volume: left.volume + right.volume, weight: left.weight + right.weight }; }
  function loadFits(load, capacity) { return load.volume <= capacity.volume && load.weight <= capacity.weight; }
  function fixedDriverId(scenario, vehicleId) {
    const pairs = Array.isArray(scenario.constraints.fixedDriverVehiclePairs) ? scenario.constraints.fixedDriverVehiclePairs : [];
    return text(pairs.find((row) => row.vehicleId === vehicleId)?.driverId);
  }
  function compatibleDriver(scenario, vehicle, orders, dayOffset = 0) {
    const fixed = fixedDriverId(scenario, vehicle.vehicleId);
    const candidates = scenario.drivers.filter((driver) => (!fixed || driver.driverId === fixed)
      && driver.compatibleVehicleTypes.includes(vehicle.vehicleTypeId)
      && orders.every((order) => order.requiredSkills.every((skill) => driver.skills.includes(skill)))
      && driver.shiftWindows[dayOffset % Math.max(1, driver.shiftWindows.length)]);
    if (!candidates.length || fixed) return candidates[0];
    const vehicleIndex = Math.max(0, scenario.vehicles.findIndex((row) => row.vehicleId === vehicle.vehicleId));
    return candidates[vehicleIndex % candidates.length];
  }
  function eligibleVehicles(scenario, depotId, order, selectedIds) {
    return scenario.vehicles.filter((vehicle) => (!selectedIds || selectedIds.has(vehicle.vehicleId))
      && vehicle.availabilityWindows.length
      && (vehicle.homeDepotId === depotId || vehicle.allowedStartDepotIds.includes(depotId))
      && (!order.requiredVehicleTypes.length || order.requiredVehicleTypes.includes(vehicle.vehicleTypeId))
      && compatibleDriver(scenario, vehicle, [order]));
  }
  function routeGeometry(scenario, depotById, group, startDepotId, endDepotId) {
    const speed = Math.max(1, asNumber(scenario.assumptions.averageSpeedKph, 32)); const factor = Math.max(1, asNumber(scenario.assumptions.syntheticRoadFactor, 1));
    const points = [depotById.get(startDepotId).coordinate, ...group.orders.map((order) => order.coordinate), depotById.get(endDepotId).coordinate];
    const legs = [];
    for (let index = 1; index < points.length; index += 1) { const km = round(distanceKm(points[index - 1], points[index]) * factor); legs.push({ fromIndex: index - 1, toIndex: index, distanceKm: km, durationMinutes: Math.max(1, Math.ceil(km / speed * 60)) }); }
    return { legs, distanceKm: round(legs.reduce((sum, leg) => sum + leg.distanceKm, 0)), drivingMinutes: legs.reduce((sum, leg) => sum + leg.durationMinutes, 0) };
  }
  function tripProjection(plan) {
    const { networkPlanHash, ...projection } = plan;
    return projection;
  }
  function chainProjection(plan, vehicleId) {
    return plan.trips.filter((trip) => trip.vehicleId === vehicleId).sort((a, b) => a.tripIndex - b.tripIndex).map((trip) => ({ tripId: trip.tripId, vehicleId: trip.vehicleId, physicalVehicleId: trip.physicalVehicleId, virtualVehicle: trip.virtualVehicle, driverId: trip.driverId, tripIndex: trip.tripIndex, startDepotId: trip.startDepotId, endDepotId: trip.endDepotId, startMinute: trip.startMinute, endMinute: trip.endMinute, routeId: trip.routeId, predecessorTripId: trip.predecessorTripId, successorTripId: trip.successorTripId }));
  }
  function scheduleBreak(scenario, driver, state, cursor, locationId, options) {
    const requirement = (driver.requiredBreaks || []).find((row) => state.drivingMinutes >= asNumber(row.triggerDrivingMinutes, Infinity) && !state.breakIds.has(row.breakId));
    if (!requirement) return { cursor, event: null };
    const earliest = absoluteMinute(requirement.earliestStart, scenario, options.dayOffset || 0); const latest = absoluteMinute(requirement.latestStart, scenario, options.dayOffset || 0);
    const start = Math.max(cursor, earliest); const duration = Math.max(1, asNumber(requirement.duration));
    if (start > latest) return { cursor, blocked: true, code: "BREAK_UNAVAILABLE" };
    let resolvedLocationId = locationId; let locationType = "STOP";
    if (requirement.locationPolicy === "DEPOT_ONLY") locationType = "DEPOT";
    if (requirement.locationPolicy === "REST_AREA_FIXTURE") { resolvedLocationId = text(scenario.constraints.restAreaFixtures?.[0]?.restAreaId); locationType = "REST_AREA_FIXTURE"; if (!resolvedLocationId) return { cursor, blocked: true, code: "BREAK_UNAVAILABLE" }; }
    const event = { eventId: `BREAK-${driver.driverId}-${requirement.breakId}`, kind: "BREAK", breakId: requirement.breakId, driverId: driver.driverId, startMinute: start, endMinute: start + duration, startTime: formatMinute(start), endTime: formatMinute(start + duration), durationMinutes: duration, locationId: resolvedLocationId, locationType, locationPolicy: requirement.locationPolicy, solverApplied: true, executionStatus: "PLANNED" };
    state.breakIds.add(requirement.breakId); state.continuousDrivingMinutes = 0;
    return { cursor: event.endMinute, event };
  }

  function planTrips(source, options = {}) {
    const identities = Contract.identityBundle(source, { stage: "TRIP_CHAIN", maxStopsPerTrip: options.maxStopsPerTrip || 4, dayOffset: options.dayOffset || 0 });
    const scenario = identities.scenario; const assignmentResult = options.assignmentResult || Assignment.assignDepots(source, options.assignmentOptions || {});
    const orderById = new Map(scenario.orders.map((order) => [order.orderId, order])); const depotById = new Map(scenario.depots.map((depot) => [depot.depotId, depot]));
    const vehicleById = new Map(scenario.vehicles.map((vehicle) => [vehicle.vehicleId, vehicle])); const typeById = new Map(scenario.vehicleTypes.map((type) => [type.vehicleTypeId, type]));
    const selectedIds = options.vehicleIds ? new Set(options.vehicleIds) : null; const maxStops = Math.max(1, Number(options.maxStopsPerTrip || 4)); const groupsByVehicle = new Map(); const depotCursor = new Map(); const unassigned = [...assignmentResult.unassigned.map((row) => ({ ...row, stage: "DEPOT_ASSIGNMENT" }))];
    for (const assignmentRow of assignmentResult.assignments) {
      const order = orderById.get(assignmentRow.orderId); const candidates = eligibleVehicles(scenario, assignmentRow.assignedDepotId, order, selectedIds);
      if (!candidates.length) { unassigned.push({ orderId: order.orderId, reasonCode: "VEHICLE_UNAVAILABLE", reason: reasonText("VEHICLE_UNAVAILABLE", options.locale), stage: "TRIP_CHAIN" }); continue; }
      const cursorKey = assignmentRow.assignedDepotId; const startAt = depotCursor.get(cursorKey) || 0; let placed = false;
      for (let offset = 0; offset < candidates.length && !placed; offset += 1) {
        const vehicle = candidates[(startAt + offset) % candidates.length]; const groups = groupsByVehicle.get(vehicle.vehicleId) || []; const type = typeById.get(vehicle.vehicleTypeId); const capacity = capacityOf(vehicle, type); const maxTrips = Math.min(vehicle.maxTrips, asNumber(scenario.constraints.maxTripsPerVehicle, vehicle.maxTrips));
        let group = groups[groups.length - 1]; const nextLoad = addLoad(group?.load || { volume: 0, weight: 0 }, orderLoad(order));
        if (!group || group.orders.length >= maxStops || !loadFits(nextLoad, capacity)) { if (groups.length >= maxTrips) continue; group = { orders: [], load: { volume: 0, weight: 0 }, assignmentDepotId: assignmentRow.assignedDepotId }; groups.push(group); }
        group.orders.push(order); group.load = addLoad(group.load, orderLoad(order)); groupsByVehicle.set(vehicle.vehicleId, groups); depotCursor.set(cursorKey, (candidates.indexOf(vehicle) + 1) % candidates.length); placed = true;
      }
      if (!placed) unassigned.push({ orderId: order.orderId, reasonCode: "MAX_TRIPS_EXCEEDED", reason: reasonText("MAX_TRIPS_EXCEEDED", options.locale), stage: "TRIP_CHAIN" });
    }

    const trips = []; const routes = []; const loadEvents = []; const unloadEvents = []; const reloadEvents = []; const repositionLegs = []; const breakEvents = []; const timelineEvents = []; const explanations = []; const driverDutyAudit = []; const invalidGroupOrders = new Set();
    for (const [vehicleId, groups] of [...groupsByVehicle].sort((a, b) => Contract.utf8Compare(a[0], b[0]))) {
      const vehicle = vehicleById.get(vehicleId); const type = typeById.get(vehicle.vehicleTypeId); const state = { cursor: absoluteMinute(options.startTime || scenario.planningHorizon.businessDayStart, scenario, options.dayOffset || 0), drivingMinutes: 0, continuousDrivingMinutes: 0, dutyStart: null, breakIds: new Set(), locationId: vehicle.homeDepotId };
      const plannedIds = groups.map((_, index) => `${vehicleId}-T${index + 1}`);
      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index]; const tripId = plannedIds[index]; const previousTripId = index ? plannedIds[index - 1] : ""; const nextTripId = index + 1 < groups.length ? plannedIds[index + 1] : "";
        const startDepotId = text(options.startDepotSequence?.[vehicleId]?.[index] || group.assignmentDepotId || state.locationId); const endDepotId = text(options.endDepotSequence?.[vehicleId]?.[index] || startDepotId); const driver = compatibleDriver(scenario, vehicle, group.orders, options.dayOffset || 0);
        if (!driver) { group.orders.forEach((order) => invalidGroupOrders.add(order.orderId)); unassigned.push(...group.orders.map((order) => ({ orderId: order.orderId, reasonCode: "DRIVER_UNAVAILABLE", reason: reasonText("DRIVER_UNAVAILABLE", options.locale), stage: "TRIP_CHAIN" }))); continue; }
        if (state.locationId !== startDepotId) {
          const fromDepot = depotById.get(state.locationId); const toDepot = depotById.get(startDepotId); const km = round(distanceKm(fromDepot.coordinate, toDepot.coordinate) * asNumber(scenario.assumptions.syntheticRoadFactor, 1)); const duration = Math.max(1, Math.ceil(km / Math.max(1, asNumber(scenario.assumptions.averageSpeedKph, 32)) * 60));
          const leg = { repositionId: `REPOS-${vehicleId}-${index + 1}`, kind: "EMPTY_REPOSITION", vehicleId, driverId: driver.driverId, fromDepotId: state.locationId, toDepotId: startDepotId, beforeTripId: tripId, startMinute: state.cursor, endMinute: state.cursor + duration, distanceKm: km, durationMinutes: duration, cost: round(km * asNumber(type.cost?.perKm) + duration * asNumber(type.cost?.perMinute)), carbonKg: round(km * asNumber(type.emission?.emptyKgPerKm)), source: "ESTIMATED_HAVERSINE_SYNTHETIC_FACTOR" };
          repositionLegs.push(leg); timelineEvents.push(leg); state.cursor = leg.endMinute; state.drivingMinutes += duration; state.continuousDrivingMinutes += duration; state.locationId = startDepotId;
        }
        if (index > 0) {
          const depot = depotById.get(startDepotId); const dock = scenario.docks.find((row) => row.depotId === startDepotId && ["LOAD", "MIXED"].includes(row.type) && row.compatibleVehicleTypes.includes(vehicle.vehicleTypeId));
          if (!depot?.reloadSupported || !vehicle.reloadCompatibility.includes(startDepotId) || !dock) { group.orders.forEach((order) => invalidGroupOrders.add(order.orderId)); unassigned.push(...group.orders.map((order) => ({ orderId: order.orderId, reasonCode: "RELOAD_UNAVAILABLE", reason: reasonText("RELOAD_UNAVAILABLE", options.locale), stage: "TRIP_CHAIN" }))); continue; }
          const duration = Math.max(1, dock.fixedSetupMinutes + Math.ceil(group.load.volume / Math.max(dock.loadRate, 0.001))); const reservationId = `RES-${tripId}`;
          const reload = { reloadEventId: `RELOAD-${tripId}`, eventId: `RELOAD-${tripId}`, kind: "RELOAD", depotId: startDepotId, dockId: dock.dockId, dockReservationId: reservationId, vehicleId, driverId: driver.driverId, tripIdBefore: previousTripId, tripIdAfter: tripId, startMinute: state.cursor, endMinute: state.cursor + duration, startTime: formatMinute(state.cursor), endTime: formatMinute(state.cursor + duration), durationMinutes: duration, volume: group.load.volume, weight: group.load.weight, capacityReset: clone(group.load) };
          reloadEvents.push(reload); timelineEvents.push(reload); state.cursor = reload.endMinute;
        }
        const breakResult = scheduleBreak(scenario, driver, state, state.cursor, startDepotId, options);
        if (breakResult.blocked) { group.orders.forEach((order) => invalidGroupOrders.add(order.orderId)); unassigned.push(...group.orders.map((order) => ({ orderId: order.orderId, reasonCode: breakResult.code, reason: reasonText(breakResult.code, options.locale), stage: "TRIP_CHAIN" }))); continue; }
        if (breakResult.event) { breakEvents.push(breakResult.event); timelineEvents.push(breakResult.event); explanations.push({ subjectId: breakResult.event.breakId, reasonCode: "REQUIRED_BREAK_SCHEDULED", message: `Break ${breakResult.event.breakId} was scheduled by the solver.`, facts: { driverId: driver.driverId, durationMinutes: breakResult.event.durationMinutes, locationPolicy: breakResult.event.locationPolicy } }); state.cursor = breakResult.cursor; }
        const geometry = routeGeometry(scenario, depotById, group, startDepotId, endDepotId); const release = Math.max(...group.orders.map((order) => absoluteMinute(order.releaseTime, scenario, options.dayOffset || 0))); state.cursor = Math.max(state.cursor, release);
        const loadDuration = Math.max(1, 5 + Math.ceil(group.load.volume / 4)); const serviceMinutes = group.orders.reduce((sum, order) => sum + order.serviceDuration, 0); const unloadDuration = 5; const tripStart = state.cursor; const tripEnd = tripStart + loadDuration + geometry.drivingMinutes + serviceMinutes + unloadDuration;
        const shift = windowBounds(driver.shiftWindows[(options.dayOffset || 0) % driver.shiftWindows.length], scenario, options.dayOffset || 0); const dutyStart = state.dutyStart ?? tripStart; const projectedDriving = state.drivingMinutes + geometry.drivingMinutes;
        if (!covers(vehicle.availabilityWindows, tripStart, tripEnd, scenario, options.dayOffset || 0) || maintenanceConflict(scenario, vehicleId, tripStart, tripEnd, options.dayOffset || 0)) { group.orders.forEach((order) => invalidGroupOrders.add(order.orderId)); unassigned.push(...group.orders.map((order) => ({ orderId: order.orderId, reasonCode: "VEHICLE_UNAVAILABLE", reason: reasonText("VEHICLE_UNAVAILABLE", options.locale), stage: "TRIP_CHAIN" }))); continue; }
        if (tripStart < shift[0] || tripEnd > shift[1] || tripEnd - dutyStart > driver.maxDutyMinutes) { group.orders.forEach((order) => invalidGroupOrders.add(order.orderId)); unassigned.push(...group.orders.map((order) => ({ orderId: order.orderId, reasonCode: "DUTY_LIMIT_EXCEEDED", reason: reasonText("DUTY_LIMIT_EXCEEDED", options.locale), stage: "TRIP_CHAIN" }))); continue; }
        if (projectedDriving > driver.maxDrivingMinutes) { group.orders.forEach((order) => invalidGroupOrders.add(order.orderId)); unassigned.push(...group.orders.map((order) => ({ orderId: order.orderId, reasonCode: "DRIVING_LIMIT_EXCEEDED", reason: reasonText("DRIVING_LIMIT_EXCEEDED", options.locale), stage: "TRIP_CHAIN" }))); continue; }
        const routeId = `ROUTE-${tripId}`; const loadEventId = `LOAD-${tripId}`; const unloadEventId = `UNLOAD-${tripId}`; const reloadEventId = index ? `RELOAD-${tripId}` : "";
        const loadEvent = { eventId: loadEventId, kind: "LOAD", tripId, vehicleId, driverId: driver.driverId, depotId: startDepotId, startMinute: tripStart, endMinute: tripStart + loadDuration, volume: group.load.volume, weight: group.load.weight };
        const unloadEvent = { eventId: unloadEventId, kind: "UNLOAD", tripId, vehicleId, driverId: driver.driverId, depotId: endDepotId, startMinute: tripEnd - unloadDuration, endMinute: tripEnd, volume: group.load.volume, weight: group.load.weight };
        const route = { routeId, tripId, stops: group.orders.map((order, stopIndex) => ({ stopIndex: stopIndex + 1, orderId: order.orderId, taskType: order.taskType, coordinate: order.coordinate, serviceDuration: order.serviceDuration })), roadRouteHash: Contract.hashArtifact({ vehicleId, startDepotId, endDepotId, orders: group.orders.map((order) => order.orderId), routingContextHash: identities.routingContextHash }), matrixHash: identities.routingContextHash, metrics: { distanceKm: geometry.distanceKm, drivingMinutes: geometry.drivingMinutes, serviceMinutes }, legs: geometry.legs, distanceSource: "ESTIMATED_HAVERSINE_SYNTHETIC_FACTOR" };
        const trip = { tripId, vehicleId, physicalVehicleId: vehicleId, virtualVehicle: false, driverId: driver.driverId, tripIndex: index + 1, startDepotId, endDepotId, startTime: formatMinute(tripStart), endTime: formatMinute(tripEnd), startMinute: tripStart, endMinute: tripEnd, routeId, loadEventId, unloadEventId, reloadEventId, predecessorTripId: previousTripId, successorTripId: nextTripId, orderIds: group.orders.map((order) => order.orderId), disposition: "PLANNED" };
        trips.push(trip); routes.push(route); loadEvents.push(loadEvent); unloadEvents.push(unloadEvent); timelineEvents.push(loadEvent, { eventId: `DRIVE-${tripId}`, kind: "DRIVE", tripId, vehicleId, driverId: driver.driverId, startMinute: loadEvent.endMinute, endMinute: loadEvent.endMinute + geometry.drivingMinutes, durationMinutes: geometry.drivingMinutes }, ...group.orders.map((order, stopIndex) => ({ eventId: `SERVICE-${tripId}-${stopIndex + 1}`, kind: "SERVICE", tripId, vehicleId, driverId: driver.driverId, orderId: order.orderId, startMinute: loadEvent.endMinute + geometry.drivingMinutes + group.orders.slice(0, stopIndex).reduce((sum, row) => sum + row.serviceDuration, 0), endMinute: loadEvent.endMinute + geometry.drivingMinutes + group.orders.slice(0, stopIndex + 1).reduce((sum, row) => sum + row.serviceDuration, 0) })), unloadEvent);
        state.cursor = tripEnd; state.locationId = endDepotId; state.drivingMinutes = projectedDriving; state.continuousDrivingMinutes += geometry.drivingMinutes; state.dutyStart = dutyStart;
      }
      const vehicleTrips = trips.filter((trip) => trip.vehicleId === vehicleId); if (vehicleTrips.length) driverDutyAudit.push({ driverId: vehicleTrips[0].driverId, vehicleId, dutyStartMinute: state.dutyStart, dutyEndMinute: state.cursor, dutyMinutes: state.cursor - state.dutyStart, drivingMinutes: state.drivingMinutes, breakIds: [...state.breakIds].sort(Contract.utf8Compare), status: "PASS" });
    }
    const validTrips = trips.filter((trip) => !trip.orderIds.some((orderId) => invalidGroupOrders.has(orderId))); const validTripIds = new Set(validTrips.map((trip) => trip.tripId));
    const filtered = (rows, key = "tripId") => rows.filter((row) => !row[key] || validTripIds.has(row[key]) || (row.tripIdAfter && validTripIds.has(row.tripIdAfter)) || row.kind === "BREAK" || row.kind === "EMPTY_REPOSITION");
    const validReloadEvents = reloadEvents.filter((row) => validTripIds.has(row.tripIdAfter));
    const plan = { schemaVersion: "stct-trip-chain-plan-v1.8", networkInputHash: identities.networkInputHash, routingContextHash: identities.routingContextHash, solveContextHash: identities.solveContextHash, trips: validTrips, routes: filtered(routes), loadEvents: filtered(loadEvents), unloadEvents: filtered(unloadEvents), reloadEvents: validReloadEvents, dockReservations: validReloadEvents.map((row) => ({ reservationId: row.dockReservationId, dockId: row.dockId, depotId: row.depotId, vehicleId: row.vehicleId, tripId: row.tripIdAfter, startMinute: row.startMinute, endMinute: row.endMinute, purpose: "RELOAD" })), repositionLegs, breakEvents, timelineEvents: filtered(timelineEvents), executionEvents: filtered(timelineEvents).map((event) => ({ ...event, executionStatus: event.executionStatus || "PLANNED" })), explanations, unassigned: [...new Map(unassigned.map((row) => [row.orderId, row])).values()].sort((a, b) => Contract.utf8Compare(a.orderId, b.orderId)), driverDutyAudit, assumptions: { routing: "ESTIMATED_HAVERSINE_SYNTHETIC_FACTOR", localDeterministic: true } };
    plan.tripChains = [...new Set(plan.trips.map((trip) => trip.vehicleId))].sort(Contract.utf8Compare).map((vehicleId) => ({ vehicleId, tripIds: chainProjection(plan, vehicleId).map((trip) => trip.tripId), tripChainHash: Contract.hashArtifact(chainProjection(plan, vehicleId)) }));
    const assignedIds = new Set(plan.trips.flatMap((trip) => trip.orderIds)); const unassignedIds = new Set(plan.unassigned.map((row) => row.orderId));
    plan.dispositions = scenario.orders.map((order) => ({ orderId: order.orderId, disposition: assignedIds.has(order.orderId) ? "PLANNED" : unassignedIds.has(order.orderId) ? "UNASSIGNED" : "BLOCKED", tripId: plan.trips.find((trip) => trip.orderIds.includes(order.orderId))?.tripId || "", reasonCode: plan.unassigned.find((row) => row.orderId === order.orderId)?.reasonCode || "" }));
    plan.metrics = { tripCount: plan.trips.length, assignedOrders: assignedIds.size, unassignedOrders: plan.unassigned.length, repositionDistanceKm: round(repositionLegs.reduce((sum, row) => sum + row.distanceKm, 0)), repositionMinutes: repositionLegs.reduce((sum, row) => sum + row.durationMinutes, 0), repositionCost: round(repositionLegs.reduce((sum, row) => sum + row.cost, 0)), repositionCarbonKg: round(repositionLegs.reduce((sum, row) => sum + row.carbonKg, 0)), routeDistanceKm: round(plan.routes.reduce((sum, row) => sum + row.metrics.distanceKm, 0)), drivingMinutes: plan.routes.reduce((sum, row) => sum + row.metrics.drivingMinutes, 0) + repositionLegs.reduce((sum, row) => sum + row.durationMinutes, 0), breakMinutes: breakEvents.reduce((sum, row) => sum + row.durationMinutes, 0) };
    plan.networkPlanHash = Contract.hashArtifact(tripProjection(plan));
    return plan;
  }

  function verifyTripPlan(source, plan) {
    const identities = Contract.identityBundle(source, { stage: "TRIP_CHAIN", maxStopsPerTrip: 4, dayOffset: 0 }); const scenario = identities.scenario; const issues = [];
    const add = (code) => { if (!issues.includes(code)) issues.push(code); }; const tripById = new Map((plan.trips || []).map((trip) => [trip.tripId, trip])); const routeById = new Map((plan.routes || []).map((route) => [route.routeId, route]));
    const vehicleById = new Map(scenario.vehicles.map((row) => [row.vehicleId, row])); const driverById = new Map(scenario.drivers.map((row) => [row.driverId, row])); const depotIds = new Set(scenario.depots.map((row) => row.depotId)); const orderById = new Map(scenario.orders.map((row) => [row.orderId, row]));
    if (plan.networkInputHash !== identities.networkInputHash) add("STALE_NETWORK_INPUT"); if (plan.routingContextHash !== identities.routingContextHash) add("STALE_ROUTING_CONTEXT");
    if (Contract.hashArtifact(tripProjection(plan)) !== plan.networkPlanHash) add("NETWORK_PLAN_HASH_MISMATCH");
    for (const chain of plan.tripChains || []) {
      const rows = chainProjection(plan, chain.vehicleId); const vehicle = vehicleById.get(chain.vehicleId); if (!vehicle || rows.length > Math.min(vehicle.maxTrips, asNumber(scenario.constraints.maxTripsPerVehicle, vehicle.maxTrips))) add("MAX_TRIPS_EXCEEDED");
      if (rows.some((trip, index) => trip.tripIndex !== index + 1)) add("TRIP_INDEX_GAP");
      if (rows.some((trip, index) => trip.predecessorTripId !== (index ? rows[index - 1].tripId : "") || trip.successorTripId !== (index + 1 < rows.length ? rows[index + 1].tripId : ""))) add("TRIP_LINK_MISMATCH");
      if (rows.some((trip, index) => index && rows[index - 1].endMinute > trip.startMinute)) add("VEHICLE_TRIP_OVERLAP");
      if (rows.some((trip) => trip.physicalVehicleId !== trip.vehicleId || trip.virtualVehicle)) add("VIRTUAL_VEHICLE_MASQUERADE");
      if (Contract.hashArtifact(rows) !== chain.tripChainHash) add("TRIP_CHAIN_HASH_MISMATCH");
      rows.forEach((trip, index) => { if (!index) return; const previous = rows[index - 1]; if (previous.endDepotId !== trip.startDepotId && !(plan.repositionLegs || []).some((leg) => leg.vehicleId === trip.vehicleId && leg.fromDepotId === previous.endDepotId && leg.toDepotId === trip.startDepotId && leg.beforeTripId === trip.tripId && leg.kind === "EMPTY_REPOSITION")) add("TRIP_LOCATION_DISCONTINUITY"); });
    }
    for (const trip of plan.trips || []) {
      const vehicle = vehicleById.get(trip.vehicleId); const driver = driverById.get(trip.driverId); const route = routeById.get(trip.routeId);
      const dayOffset = Math.floor(trip.startMinute / 1440);
      if (!vehicle || !driver) add("TRIP_RESOURCE_UNKNOWN"); if (!depotIds.has(trip.startDepotId) || !depotIds.has(trip.endDepotId)) add("TRIP_DEPOT_UNKNOWN"); if (!(trip.startMinute < trip.endMinute)) add("TRIP_TIME_INVALID"); if (!trip.routeId || !route) add("TRIP_ROUTE_MISSING");
      if (!trip.orderIds?.length && !trip.repositionOnly) add("EMPTY_TRIP"); if (route && !route.stops?.length && !trip.repositionOnly) add("TRIP_BUSINESS_STOP_MISSING");
      if (!(plan.loadEvents || []).some((row) => row.eventId === trip.loadEventId) || !(plan.unloadEvents || []).some((row) => row.eventId === trip.unloadEventId)) add("TRIP_LOAD_EVENT_MISSING");
      if (trip.tripIndex > 1) { const reload = (plan.reloadEvents || []).find((row) => row.reloadEventId === trip.reloadEventId); if (!reload) add("RELOAD_MISSING"); else { const depot = scenario.depots.find((row) => row.depotId === reload.depotId); if (!depot?.reloadSupported || !vehicle?.reloadCompatibility.includes(reload.depotId)) add("RELOAD_DEPOT_INELIGIBLE"); if (!(reload.endMinute > reload.startMinute) || !(reload.durationMinutes > 0)) add("RELOAD_DURATION_INVALID"); if (reload.volume < 0 || reload.weight < 0) add("RELOAD_LOAD_INVALID"); if (!reload.dockReservationId || !reload.dockId || !(plan.dockReservations || []).some((row) => row.reservationId === reload.dockReservationId && row.tripId === trip.tripId)) add("RELOAD_RESERVATION_MISSING"); const expected = route.stops.reduce((sum, stop) => addLoad(sum, orderLoad(orderById.get(stop.orderId))), { volume: 0, weight: 0 }); if (reload.volume !== expected.volume || reload.weight !== expected.weight) add("RELOAD_CAPACITY_RESET_MISMATCH"); if (reload.tripIdBefore && tripById.get(reload.tripIdBefore)?.endMinute > reload.startMinute) add("TRIP_PREDECESSOR_INCOMPLETE"); } }
      const release = Math.max(...trip.orderIds.map((orderId) => absoluteMinute(orderById.get(orderId).releaseTime, scenario, dayOffset))); if (trip.startMinute < release) add("TRIP_RELEASE_VIOLATION");
      if (driver && vehicle && !driver.compatibleVehicleTypes.includes(vehicle.vehicleTypeId)) add("DRIVER_VEHICLE_INCOMPATIBLE"); if (driver && trip.orderIds.some((orderId) => !orderById.get(orderId).requiredSkills.every((skill) => driver.skills.includes(skill)))) add("DRIVER_SKILL_MISSING");
      if (driver && !covers(driver.shiftWindows, trip.startMinute, trip.endMinute, scenario, dayOffset)) add("DRIVER_SHIFT_VIOLATION");
      if (vehicle && (!covers(vehicle.availabilityWindows, trip.startMinute, trip.endMinute, scenario, dayOffset) || maintenanceConflict(scenario, vehicle.vehicleId, trip.startMinute, trip.endMinute, dayOffset))) add("VEHICLE_UNAVAILABLE"); const fixed = vehicle ? fixedDriverId(scenario, vehicle.vehicleId) : ""; if (fixed && fixed !== trip.driverId) add("FIXED_DRIVER_VEHICLE_VIOLATION");
    }
    const orderedTrips = [...(plan.trips || [])].sort((a, b) => a.startMinute - b.startMinute || Contract.utf8Compare(a.tripId, b.tripId));
    for (let left = 0; left < orderedTrips.length; left += 1) for (let right = left + 1; right < orderedTrips.length; right += 1) if (orderedTrips[left].driverId === orderedTrips[right].driverId && intervalOverlaps(orderedTrips[left].startMinute, orderedTrips[left].endMinute, orderedTrips[right].startMinute, orderedTrips[right].endMinute)) add("DRIVER_SHIFT_OVERLAP");
    for (const driver of scenario.drivers) {
      const trips = orderedTrips.filter((trip) => trip.driverId === driver.driverId); if (!trips.length) continue; const audit = (plan.driverDutyAudit || []).find((row) => row.driverId === driver.driverId); const driving = (plan.routes || []).filter((route) => trips.some((trip) => trip.tripId === route.tripId)).reduce((sum, route) => sum + route.metrics.drivingMinutes, 0) + (plan.repositionLegs || []).filter((leg) => leg.driverId === driver.driverId).reduce((sum, leg) => sum + leg.durationMinutes, 0); const dutyStart = Math.min(...trips.map((trip) => trip.startMinute), ...(plan.timelineEvents || []).filter((event) => event.driverId === driver.driverId).map((event) => event.startMinute)); const dutyEnd = Math.max(...trips.map((trip) => trip.endMinute), ...(plan.timelineEvents || []).filter((event) => event.driverId === driver.driverId).map((event) => event.endMinute));
      if (driving > driver.maxDrivingMinutes) add("DRIVER_DRIVING_LIMIT"); if (dutyEnd - dutyStart > driver.maxDutyMinutes) add("DRIVER_DUTY_LIMIT"); if (!audit || audit.drivingMinutes !== driving || audit.dutyMinutes !== audit.dutyEndMinute - audit.dutyStartMinute) add("DRIVER_DUTY_AUDIT_MISMATCH");
      for (const requirement of driver.requiredBreaks || []) { if (driving < asNumber(requirement.triggerDrivingMinutes, Infinity)) continue; const event = (plan.breakEvents || []).find((row) => row.driverId === driver.driverId && row.breakId === requirement.breakId); if (!event) { add("REQUIRED_BREAK_MISSING"); continue; } const earliest = absoluteMinute(requirement.earliestStart, scenario); const latest = absoluteMinute(requirement.latestStart, scenario); if (event.durationMinutes < requirement.duration || event.endMinute - event.startMinute !== event.durationMinutes) add("BREAK_DURATION_INVALID"); if (event.startMinute < earliest || event.startMinute > latest) add("BREAK_WINDOW_INVALID"); if (event.locationPolicy !== requirement.locationPolicy || requirement.locationPolicy === "DEPOT_ONLY" && !depotIds.has(event.locationId) || requirement.locationPolicy === "REST_AREA_FIXTURE" && event.locationType !== "REST_AREA_FIXTURE") add("BREAK_LOCATION_INVALID"); if (!event.solverApplied) add("BREAK_NOT_SOLVER_APPLIED"); if (!(plan.timelineEvents || []).some((row) => row.eventId === event.eventId)) add("BREAK_TIMELINE_MISSING"); if (!(plan.executionEvents || []).some((row) => row.eventId === event.eventId)) add("BREAK_EXECUTION_MISSING"); if (!(plan.explanations || []).some((row) => row.subjectId === event.breakId)) add("BREAK_EXPLANATION_MISSING"); const overlaps = (plan.timelineEvents || []).some((row) => row.eventId !== event.eventId && ["DRIVE", "SERVICE"].includes(row.kind) && intervalOverlaps(event.startMinute, event.endMinute, row.startMinute, row.endMinute)); if (overlaps) add("BREAK_ACTIVITY_OVERLAP"); }
    }
    const sums = { distance: round((plan.repositionLegs || []).reduce((sum, row) => sum + row.distanceKm, 0)), minutes: (plan.repositionLegs || []).reduce((sum, row) => sum + row.durationMinutes, 0), cost: round((plan.repositionLegs || []).reduce((sum, row) => sum + row.cost, 0)), carbon: round((plan.repositionLegs || []).reduce((sum, row) => sum + row.carbonKg, 0)) };
    if (plan.metrics?.repositionDistanceKm !== sums.distance) add("REPOSITION_DISTANCE_MISMATCH"); if (plan.metrics?.repositionMinutes !== sums.minutes) add("REPOSITION_TIME_MISMATCH"); if (plan.metrics?.repositionCost !== sums.cost) add("REPOSITION_COST_MISMATCH"); if (plan.metrics?.repositionCarbonKg !== sums.carbon) add("REPOSITION_CARBON_MISMATCH");
    const dispositions = new Map((plan.dispositions || []).map((row) => [row.orderId, row])); if (dispositions.size !== scenario.orders.length || scenario.orders.some((order) => !dispositions.has(order.orderId))) add("TRIP_DISPOSITION_INCOMPLETE"); const assigned = new Set((plan.trips || []).flatMap((trip) => trip.orderIds)); if (assigned.size + (plan.unassigned || []).length !== scenario.orders.length) add("ORDER_CONSERVATION_MISMATCH");
    return { schemaVersion: "stct-trip-chain-verification-v1.8", status: issues.length ? "FAIL" : "PASS", issues, recomputed: { reposition: sums, tripCount: (plan.trips || []).length, dispositionCount: dispositions.size }, verifier: "INDEPENDENT_SEMANTIC_AND_HASH" };
  }

  function tripChainRows(plan, vehicleId = "") { return (plan.tripChains || []).filter((chain) => !vehicleId || chain.vehicleId === vehicleId).flatMap((chain) => chain.tripIds.map((tripId, index) => { const trip = plan.trips.find((row) => row.tripId === tripId); return { vehicleId: chain.vehicleId, tripId, tripIndex: index + 1, driverId: trip.driverId, startTime: trip.startTime, endTime: trip.endTime, startDepotId: trip.startDepotId, endDepotId: trip.endDepotId, orderCount: trip.orderIds.length, status: trip.disposition }; })); }
  function keyboardMove(plan, vehicleId, tripId, direction) { const ids = plan.tripChains.find((chain) => chain.vehicleId === vehicleId)?.tripIds || []; const current = Math.max(0, ids.indexOf(tripId)); return ids[Math.max(0, Math.min(ids.length - 1, current + (direction === "NEXT" ? 1 : -1)))] || ""; }
  function mobileChain(plan, vehicleId) { return { layout: "BOTTOM_SHEET", closeAction: "RETURN_TO_CHAIN", rows: tripChainRows(plan, vehicleId) }; }
  function animationPolicy(reducedMotion) { return { reducedMotion: Boolean(reducedMotion), animateVehicle: !reducedMotion, meaningPreserved: true }; }
  function createCapsule(source, plan) { const identity = Contract.identityBundle(source, { stage: "TRIP_CHAIN_CAPSULE" }); const capsule = { schemaVersion: "stct-trip-capsule-v1.8", networkInputHash: identity.networkInputHash, routingContextHash: identity.routingContextHash, networkPlanHash: plan.networkPlanHash, tripChainHashes: plan.tripChains.map((row) => row.tripChainHash), plan: clone(plan) }; capsule.capsuleHash = Contract.hashArtifact(capsule); return capsule; }
  function replay(source, capsule) { const verification = verifyTripPlan(source, capsule.plan); const { capsuleHash, ...payload } = capsule; const hashMatches = Contract.hashArtifact(payload) === capsuleHash; return { status: verification.status === "PASS" && capsule.plan.networkPlanHash === capsule.networkPlanHash && hashMatches ? "EQUIVALENT" : "MISMATCH", verification, hashMatches }; }

  return { VERSION, REASONS, reasonText, clockMinute, absoluteMinute, formatMinute, distanceKm, planTrips, verifyTripPlan, tripChainRows, keyboardMove, mobileChain, animationPolicy, createCapsule, replay, chainProjection, tripProjection };
});
