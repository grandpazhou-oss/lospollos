(function (root, factory) {
  "use strict";
  const experience = root?.STCTExperienceFactory || (typeof require === "function" ? require("./experience-v14.js") : null);
  const api = factory(experience);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.STCTReplay = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Experience) {
  "use strict";

  const VEHICLE_STATUS = Object.freeze({
    NOT_STARTED: "NOT_STARTED",
    TRAVELING: "TRAVELING",
    SERVICING: "SERVICING",
    WAITING_FOR_WINDOW: "WAITING_FOR_WINDOW",
    COMPLETED: "COMPLETED",
    SIMULATED_DELAY: "SIMULATED_DELAY",
  });
  const SPEEDS = Object.freeze([1, 4, 16, 60]);

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function compare(left, right) {
    if (Experience?.utf8Compare) return Experience.utf8Compare(left, right);
    return text(left).localeCompare(text(right));
  }

  function timeToMinutes(value, fallback = 0) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const match = /^(\d{1,2}):(\d{2})$/.exec(text(value));
    if (!match) return fallback;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return fallback;
    return hour * 60 + minute;
  }

  function normalizeClock(value, routeStart) {
    let result = timeToMinutes(value, routeStart);
    while (result < routeStart) result += 24 * 60;
    return result;
  }

  function timeText(value) {
    const minute = Math.max(0, Math.round(number(value)));
    const hour = Math.floor(minute / 60) % 24;
    return `${String(hour).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  }

  function planValidation(plan, scenario) {
    if (Experience?.verifyPlanShape) return Experience.verifyPlanShape(plan, scenario);
    const reasons = [];
    if (!scenario?.inputHash) reasons.push("MISSING_CANONICAL_SCENARIO");
    if (plan?.verification?.status !== "PASS") reasons.push("VERIFIER_NOT_PASS");
    if (plan?.inputHash !== scenario?.inputHash) reasons.push("PLAN_INPUT_HASH_MISMATCH");
    if (plan?.verification?.computedPlanHash && plan.planHash !== plan.verification.computedPlanHash) reasons.push("PLAN_HASH_MISMATCH");
    if (!plan?.verification?.recomputedMetrics) reasons.push("MISSING_RECOMPUTED_METRICS");
    return { status: reasons.length ? "FAIL" : "PASS", reasons };
  }

  function featureProperties(feature) {
    return feature?.properties || feature || {};
  }

  function stopFeaturesFor(plan, routeId) {
    return (plan?.stopGeoJson?.features || [])
      .filter((feature) => text(featureProperties(feature).routeId) === text(routeId))
      .sort((left, right) => number(featureProperties(left).seq) - number(featureProperties(right).seq)
        || compare(featureProperties(left).orderId, featureProperties(right).orderId));
  }

  function routeCoordinates(plan, route, scenario) {
    const feature = (plan?.routeGeoJson?.features || []).find((candidate) => text(featureProperties(candidate).routeId) === text(route.routeId));
    if (feature?.geometry?.type === "LineString" && feature.geometry.coordinates?.length) return clone(feature.geometry.coordinates);
    const stops = stopFeaturesFor(plan, route.routeId);
    const depot = [number(scenario?.depot?.lon), number(scenario?.depot?.lat)];
    return [depot, ...stops.map((stop) => clone(stop.geometry?.coordinates || depot)), depot];
  }

  function orderLookup(scenario) {
    return new Map((scenario?.orders || []).map((order) => [text(order.id || order.orderId || order.code), order]));
  }

  function vehicleLookup(scenario) {
    return new Map((scenario?.vehicles || []).map((vehicle) => [text(vehicle.vehicleId || vehicle.id || vehicle.code), vehicle]));
  }

  function eventDelayMap(events) {
    const map = new Map();
    (events || []).filter((event) => text(event.type || "DELAY") === "DELAY").forEach((event) => {
      const key = `${text(event.routeId)}\u0000${text(event.orderId)}`;
      map.set(key, (map.get(key) || 0) + Math.max(0, Math.round(number(event.minutes))));
    });
    return map;
  }

  function buildRouteSchedule(plan, route, scenario, simulationEvents = []) {
    const orders = orderLookup(scenario);
    const vehicles = vehicleLookup(scenario);
    const vehicle = vehicles.get(text(route.vehicleId)) || {};
    const stops = stopFeaturesFor(plan, route.routeId);
    const coordinates = routeCoordinates(plan, route, scenario);
    const startMinute = number(route.startMinutes, normalizeClock(vehicle.start || scenario?.constraintsSnapshot?.workStart || "08:00", 0));
    const shiftEnd = normalizeClock(vehicle.end || scenario?.constraintsSnapshot?.workEnd || "18:00", startMinute)
      + number(scenario?.assumptionsSnapshot?.shiftExtensionMinutes);
    const delays = eventDelayMap(simulationEvents);
    let priorDeparture = startMinute;
    let basePriorDeparture = startMinute;
    let deliveredVolume = 0;
    let deliveredWeight = 0;
    const initialVolume = stops.reduce((sum, feature) => sum + Math.max(0, number(featureProperties(feature).volume)), 0);
    const initialWeight = stops.reduce((sum, feature) => sum + Math.max(0, number(featureProperties(feature).weight)), 0);
    const scheduledStops = stops.map((feature, index) => {
      const properties = featureProperties(feature);
      const orderId = text(properties.orderId);
      const order = orders.get(orderId) || {};
      const baseRawArrival = number(properties.rawArrivalMinutes, basePriorDeparture + number(properties.travelMin));
      const travelMin = Math.max(0, number(properties.travelMin, baseRawArrival - basePriorDeparture));
      const eventDelayMin = delays.get(`${text(route.routeId)}\u0000${orderId}`) || 0;
      const travelEndMinute = priorDeparture + travelMin;
      const rawArrivalMinute = travelEndMinute + eventDelayMin;
      const windowStartMinute = normalizeClock(order.twStart || properties.twStart || timeText(number(properties.serviceStartMinutes, rawArrivalMinute)), startMinute);
      const windowEndMinute = normalizeClock(order.twEnd || properties.twEnd || timeText(number(properties.serviceStartMinutes, rawArrivalMinute) + 24 * 60), startMinute);
      const serviceStartMinute = Math.max(rawArrivalMinute, windowStartMinute);
      const serviceMin = Math.max(0, number(properties.serviceMin, order.serviceMin));
      const departureMinute = serviceStartMinute + serviceMin;
      const baseServiceStart = number(properties.serviceStartMinutes, Math.max(baseRawArrival, windowStartMinute));
      const baseDeparture = number(properties.departureMinutes, baseServiceStart + serviceMin);
      const volume = Math.max(0, number(properties.volume, order.volume));
      const weight = Math.max(0, number(properties.weight, order.weight));
      const beforeVolume = initialVolume - deliveredVolume;
      const beforeWeight = initialWeight - deliveredWeight;
      deliveredVolume += volume;
      deliveredWeight += weight;
      const coordinate = clone(feature.geometry?.coordinates || coordinates[index + 1] || coordinates.at(-1));
      const result = {
        routeId: text(route.routeId),
        vehicleId: text(route.vehicleId),
        orderId,
        code: text(properties.code || order.code),
        name: text(properties.name || order.name),
        address: text(properties.addr || properties.address || order.address),
        seq: index + 1,
        coordinate,
        fromCoordinate: clone(coordinates[index] || (scenario?.depot ? [number(scenario.depot.lon), number(scenario.depot.lat)] : coordinate)),
        travelStartMinute: priorDeparture,
        travelEndMinute,
        delayStartMinute: travelEndMinute,
        delayEndMinute: rawArrivalMinute,
        rawArrivalMinute,
        serviceStartMinute,
        departureMinute,
        baseRawArrivalMinute: baseRawArrival,
        baseServiceStartMinute: baseServiceStart,
        baseDepartureMinute: baseDeparture,
        travelMin,
        waitingMin: Math.max(0, serviceStartMinute - rawArrivalMinute),
        serviceMin,
        eventDelayMin,
        propagatedDelayMin: Math.max(0, departureMinute - baseDeparture),
        windowStartMinute,
        windowEndMinute,
        slackMin: windowEndMinute - serviceStartMinute,
        atRisk: serviceStartMinute <= windowEndMinute && windowEndMinute - serviceStartMinute <= 15,
        missedWindow: serviceStartMinute > windowEndMinute,
        priority: text(properties.priority || order.priority || "normal"),
        priorityWeight: number(properties.priorityWeight, order.priorityWeight || 1),
        volume,
        weight,
        remainingVolumeBefore: beforeVolume,
        remainingVolumeAfter: initialVolume - deliveredVolume,
        remainingWeightBefore: beforeWeight,
        remainingWeightAfter: initialWeight - deliveredWeight,
      };
      priorDeparture = departureMinute;
      basePriorDeparture = baseDeparture;
      return result;
    });
    const baseLastDeparture = scheduledStops.at(-1)?.baseDepartureMinute ?? startMinute;
    const returnTravelMin = Math.max(0, number(route.returnMinutes, baseLastDeparture) - baseLastDeparture);
    const returnStartMinute = scheduledStops.at(-1)?.departureMinute ?? startMinute;
    const returnMinute = returnStartMinute + returnTravelMin;
    return {
      routeId: text(route.routeId),
      vehicleId: text(route.vehicleId),
      vehicleName: text(route.vehicleName || vehicle.name || route.vehicleId),
      color: text(route.color || "#003b79"),
      planHash: text(plan.planHash),
      startMinute,
      shiftEndMinute: shiftEnd,
      returnStartMinute,
      returnMinute,
      baseReturnMinute: number(route.returnMinutes, returnMinute),
      returnTravelMin,
      coordinates,
      depotCoordinate: clone(coordinates[0] || [number(scenario?.depot?.lon), number(scenario?.depot?.lat)]),
      stops: scheduledStops,
      initialVolume,
      initialWeight,
      maxVolume: Math.max(0, number(route.maxVolume, vehicle.maxVolume)),
      maxWeight: Math.max(0, number(route.maxWeight, vehicle.maxWeight)),
      volumeUtilization: number(route.volumeUtilization),
      weightUtilization: number(route.weightUtilization),
      delayedMinutes: Math.max(0, returnMinute - number(route.returnMinutes, returnMinute)),
      overtimeMinutes: Math.max(0, returnMinute - shiftEnd),
    };
  }

  function buildReplayModel(plan, scenario, options = {}) {
    const validation = planValidation(plan, scenario);
    if (validation.status !== "PASS") {
      const error = new Error(`Replay requires a verified plan: ${validation.reasons.join(", ")}`);
      error.code = validation.reasons[0] || "INVALID_REPLAY_PLAN";
      error.reasons = validation.reasons;
      throw error;
    }
    const events = Experience?.canonicalSimulationEvents
      ? Experience.canonicalSimulationEvents(options.simulationEvents || [])
      : clone(options.simulationEvents || []);
    const schedules = (plan.routes || []).map((route) => buildRouteSchedule(plan, route, scenario, events))
      .sort((left, right) => compare(left.routeId, right.routeId));
    const startMinute = schedules.length ? Math.min(...schedules.map((route) => route.startMinute)) : 0;
    const endMinute = schedules.length ? Math.max(...schedules.map((route) => route.returnMinute)) : startMinute;
    const model = {
      version: "stct-replay-v1.4",
      scenarioId: text(scenario.scenarioId),
      inputHash: text(scenario.inputHash),
      planHash: text(plan.planHash),
      verificationStatus: plan.verification.status,
      engine: text(plan.meta?.engine || plan.meta?.source),
      startMinute,
      endMinute,
      schedules,
      simulationEvents: events,
      webglAvailable: options.webglAvailable !== false,
      reducedMotion: Boolean(options.reducedMotion),
    };
    model.allStops = schedules.flatMap((route) => route.stops);
    model.totalStops = model.allStops.length;
    model.totalDelayedMinutes = schedules.reduce((sum, route) => sum + route.delayedMinutes, 0);
    model.replayEvents = replayEvents(model);
    return model;
  }

  function interpolateLongitude(from, to, progress) {
    const start = number(from);
    const delta = ((number(to) - start + 540) % 360) - 180;
    const result = start + delta * clamp(progress, 0, 1);
    return ((result + 540) % 360) - 180;
  }

  function interpolateCoordinate(from, to, progress) {
    const t = clamp(number(progress), 0, 1);
    return [
      interpolateLongitude(from?.[0], to?.[0], t),
      number(from?.[1]) + (number(to?.[1]) - number(from?.[1])) * t,
    ];
  }

  function vehicleStateAt(schedule, minute) {
    const currentMinute = number(minute);
    const firstCoordinate = schedule.depotCoordinate;
    if (currentMinute < schedule.startMinute) {
      return {
        routeId: schedule.routeId,
        vehicleId: schedule.vehicleId,
        status: VEHICLE_STATUS.NOT_STARTED,
        coordinate: clone(firstCoordinate),
        bearing: 0,
        progress: 0,
        completedStops: 0,
        totalStops: schedule.stops.length,
        previousStopId: "",
        nextStopId: schedule.stops[0]?.orderId || "",
        nextEtaMinute: schedule.stops[0]?.rawArrivalMinute ?? schedule.startMinute,
        delayedMinutes: 0,
        remainingVolume: schedule.initialVolume,
        remainingWeight: schedule.initialWeight,
        slackMin: schedule.stops[0]?.slackMin ?? null,
      };
    }
    let completedStops = 0;
    let previousStopId = "";
    for (const stop of schedule.stops) {
      if (currentMinute < stop.travelEndMinute) {
        const denominator = Math.max(1, stop.travelEndMinute - stop.travelStartMinute);
        const progress = clamp((currentMinute - stop.travelStartMinute) / denominator, 0, 1);
        const coordinate = interpolateCoordinate(stop.fromCoordinate, stop.coordinate, progress);
        return statePayload(schedule, stop, VEHICLE_STATUS.TRAVELING, coordinate, completedStops, previousStopId, progress);
      }
      if (currentMinute < stop.delayEndMinute) {
        return statePayload(schedule, stop, VEHICLE_STATUS.SIMULATED_DELAY, stop.coordinate, completedStops, previousStopId, 1);
      }
      if (currentMinute < stop.serviceStartMinute) {
        return statePayload(schedule, stop, VEHICLE_STATUS.WAITING_FOR_WINDOW, stop.coordinate, completedStops, previousStopId, 1);
      }
      if (currentMinute < stop.departureMinute) {
        return statePayload(schedule, stop, VEHICLE_STATUS.SERVICING, stop.coordinate, completedStops, previousStopId, 1);
      }
      completedStops += 1;
      previousStopId = stop.orderId;
    }
    if (currentMinute < schedule.returnMinute) {
      const last = schedule.stops.at(-1);
      const denominator = Math.max(1, schedule.returnMinute - schedule.returnStartMinute);
      const progress = clamp((currentMinute - schedule.returnStartMinute) / denominator, 0, 1);
      const coordinate = interpolateCoordinate(last?.coordinate || schedule.depotCoordinate, schedule.depotCoordinate, progress);
      return {
        routeId: schedule.routeId,
        vehicleId: schedule.vehicleId,
        status: VEHICLE_STATUS.TRAVELING,
        coordinate,
        bearing: bearing(last?.coordinate || schedule.depotCoordinate, schedule.depotCoordinate),
        progress,
        completedStops,
        totalStops: schedule.stops.length,
        previousStopId,
        nextStopId: "DEPOT",
        nextEtaMinute: schedule.returnMinute,
        delayedMinutes: schedule.delayedMinutes,
        remainingVolume: 0,
        remainingWeight: 0,
        slackMin: null,
      };
    }
    return {
      routeId: schedule.routeId,
      vehicleId: schedule.vehicleId,
      status: VEHICLE_STATUS.COMPLETED,
      coordinate: clone(schedule.depotCoordinate),
      bearing: 0,
      progress: 1,
      completedStops: schedule.stops.length,
      totalStops: schedule.stops.length,
      previousStopId: schedule.stops.at(-1)?.orderId || "",
      nextStopId: "",
      nextEtaMinute: null,
      delayedMinutes: schedule.delayedMinutes,
      remainingVolume: 0,
      remainingWeight: 0,
      slackMin: null,
    };
  }

  function statePayload(schedule, stop, status, coordinate, completedStops, previousStopId, progress) {
    return {
      routeId: schedule.routeId,
      vehicleId: schedule.vehicleId,
      status,
      coordinate: clone(coordinate),
      bearing: bearing(stop.fromCoordinate, stop.coordinate),
      progress,
      completedStops,
      totalStops: schedule.stops.length,
      previousStopId,
      nextStopId: stop.orderId,
      nextEtaMinute: stop.rawArrivalMinute,
      delayedMinutes: Math.max(0, stop.propagatedDelayMin),
      remainingVolume: Math.max(0, stop.remainingVolumeBefore),
      remainingWeight: Math.max(0, stop.remainingWeightBefore),
      slackMin: stop.slackMin,
      missedWindow: stop.missedWindow,
      atRisk: stop.atRisk,
    };
  }

  function bearing(from, to) {
    const lon1 = number(from?.[0]) * Math.PI / 180;
    const lat1 = number(from?.[1]) * Math.PI / 180;
    const lon2 = number(to?.[0]) * Math.PI / 180;
    const lat2 = number(to?.[1]) * Math.PI / 180;
    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  function replayEvents(model) {
    const events = [];
    model.schedules.forEach((route) => {
      events.push({ minute: route.startMinute, routeId: route.routeId, vehicleId: route.vehicleId, orderId: "", type: "DEPARTED", label: `${route.vehicleId} departed` });
      route.stops.forEach((stop) => {
        if (stop.eventDelayMin) events.push({ minute: stop.delayStartMinute, routeId: route.routeId, vehicleId: route.vehicleId, orderId: stop.orderId, type: "SIMULATED_DELAY", label: `${route.vehicleId} simulated delay +${stop.eventDelayMin} min` });
        events.push({ minute: stop.rawArrivalMinute, routeId: route.routeId, vehicleId: route.vehicleId, orderId: stop.orderId, type: "ARRIVED", label: `Arrived at ${stop.code || stop.orderId}` });
        events.push({ minute: stop.serviceStartMinute, routeId: route.routeId, vehicleId: route.vehicleId, orderId: stop.orderId, type: "SERVICE_STARTED", label: `Service started · ${stop.code || stop.orderId}` });
        events.push({ minute: stop.departureMinute, routeId: route.routeId, vehicleId: route.vehicleId, orderId: stop.orderId, type: "SERVICE_COMPLETED", label: `Service completed · ${stop.code || stop.orderId}` });
      });
      events.push({ minute: route.returnMinute, routeId: route.routeId, vehicleId: route.vehicleId, orderId: "", type: "COMPLETED", label: `${route.vehicleId} returned to depot` });
    });
    return events.sort((left, right) => left.minute - right.minute
      || compare(left.vehicleId, right.vehicleId)
      || compare(left.type, right.type)
      || compare(left.orderId, right.orderId));
  }

  function stateAt(model, minute, selectedVehicleId = "") {
    const currentMinute = clamp(number(minute, model.startMinute), model.startMinute, model.endMinute);
    const vehicles = model.schedules.map((schedule) => vehicleStateAt(schedule, currentMinute));
    const totalStops = model.totalStops ?? vehicles.reduce((sum, vehicle) => sum + vehicle.totalStops, 0);
    const completedStops = vehicles.reduce((sum, vehicle) => sum + vehicle.completedStops, 0);
    const activeVehicles = vehicles.filter((vehicle) => ![VEHICLE_STATUS.NOT_STARTED, VEHICLE_STATUS.COMPLETED].includes(vehicle.status)).length;
    const scheduleStops = model.allStops || model.schedules.flatMap((route) => route.stops);
    const completedScheduleStops = scheduleStops.filter((stop) => currentMinute >= stop.departureMinute);
    const onTimeStops = completedScheduleStops.filter((stop) => !stop.missedWindow).length;
    const atRiskStops = scheduleStops.filter((stop) => currentMinute < stop.departureMinute && (stop.atRisk || stop.missedWindow)).length;
    const delayedMinutes = model.totalDelayedMinutes ?? model.schedules.reduce((sum, route) => sum + route.delayedMinutes, 0);
    const progress = model.endMinute > model.startMinute ? (currentMinute - model.startMinute) / (model.endMinute - model.startMinute) * 100 : 100;
    return {
      currentMinute,
      currentTime: timeText(currentMinute),
      vehicles,
      selectedVehicle: vehicles.find((vehicle) => vehicle.vehicleId === selectedVehicleId) || vehicles[0] || null,
      fleetPulse: {
        activeVehicles,
        completedStops,
        totalStops,
        onTimeStops,
        atRiskStops,
        delayedMinutes,
        progress: Math.round(clamp(progress, 0, 100) * 10) / 10,
      },
      events: (model.replayEvents || replayEvents(model)).filter((event) => event.minute <= currentMinute),
    };
  }

  function createReplayController(plan, scenario, options = {}) {
    let simulationEvents = clone(options.simulationEvents || []);
    let model = buildReplayModel(plan, scenario, { ...options, simulationEvents });
    let state = {
      status: "idle",
      currentMinute: model.startMinute,
      startMinute: model.startMinute,
      endMinute: model.endMinute,
      speed: SPEEDS.includes(number(options.speed)) ? number(options.speed) : 1,
      selectedVehicleId: text(options.selectedVehicleId || model.schedules[0]?.vehicleId),
      followVehicle: Boolean(options.followVehicle),
      simulationEvents: clone(simulationEvents),
      reducedMotion: Boolean(options.reducedMotion),
      webglAvailable: options.webglAvailable !== false,
      pausedByVisibility: false,
    };

    function snapshot() {
      return { ...clone(state), frame: stateAt(model, state.currentMinute, state.selectedVehicleId) };
    }

    function play() {
      if (state.currentMinute >= state.endMinute) state.currentMinute = state.startMinute;
      state.status = "playing";
      state.pausedByVisibility = false;
      return snapshot();
    }

    function pause() {
      if (state.status === "playing") state.status = "paused";
      return snapshot();
    }

    function restart() {
      state.currentMinute = state.startMinute;
      state.status = "idle";
      state.pausedByVisibility = false;
      return snapshot();
    }

    function setTime(minute) {
      state.currentMinute = clamp(number(minute, state.startMinute), state.startMinute, state.endMinute);
      if (state.currentMinute >= state.endMinute) state.status = "ended";
      else if (state.status === "ended") state.status = "paused";
      return snapshot();
    }

    function setSpeed(speed) {
      const value = number(speed);
      if (!SPEEDS.includes(value)) throw new Error(`Unsupported replay speed: ${speed}`);
      state.speed = value;
      return snapshot();
    }

    function advance(elapsedMilliseconds) {
      if (state.status !== "playing") return state;
      const logicalMinutes = Math.max(0, number(elapsedMilliseconds)) / 1000 * state.speed;
      const next = state.currentMinute + logicalMinutes;
      state.currentMinute = state.reducedMotion ? Math.floor(next) : next;
      if (state.currentMinute >= state.endMinute) {
        state.currentMinute = state.endMinute;
        state.status = "ended";
      }
      return state;
    }

    function tick(elapsedMilliseconds) {
      advance(elapsedMilliseconds);
      return snapshot();
    }

    function selectVehicle(vehicleId) {
      if (!model.schedules.some((route) => route.vehicleId === text(vehicleId))) throw new Error(`Unknown replay vehicle: ${vehicleId}`);
      state.selectedVehicleId = text(vehicleId);
      return snapshot();
    }

    function setFollow(value) {
      state.followVehicle = Boolean(value);
      return snapshot();
    }

    function escapeFollow() {
      state.followVehicle = false;
      return snapshot();
    }

    function handleVisibility(hidden) {
      if (hidden && state.status === "playing") {
        state.status = "paused";
        state.pausedByVisibility = true;
      } else if (!hidden) {
        state.pausedByVisibility = false;
      }
      return snapshot();
    }

    function rebuild() {
      model = buildReplayModel(plan, scenario, { ...options, simulationEvents, reducedMotion: state.reducedMotion, webglAvailable: state.webglAvailable });
      state.startMinute = model.startMinute;
      state.endMinute = model.endMinute;
      state.currentMinute = clamp(state.currentMinute, model.startMinute, model.endMinute);
      state.simulationEvents = clone(simulationEvents);
      return snapshot();
    }

    function injectDelay(event) {
      const minutes = Math.max(0, Math.round(number(event?.minutes)));
      if (![15, 30, 60].includes(minutes)) throw new Error("Replay delay must be +15, +30 or +60 minutes.");
      const route = model.schedules.find((candidate) => candidate.routeId === text(event.routeId));
      const stop = route?.stops.find((candidate) => candidate.orderId === text(event.orderId));
      if (!route || !stop) throw new Error("Replay delay requires a stop in the selected route.");
      simulationEvents.push({
        eventId: text(event.eventId || `SIM-${String(simulationEvents.length + 1).padStart(4, "0")}`),
        type: "DELAY",
        routeId: route.routeId,
        orderId: stop.orderId,
        stopIndex: stop.seq - 1,
        minutes,
        source: "user-simulation",
      });
      return rebuild();
    }

    function undoDelay() {
      simulationEvents.pop();
      return rebuild();
    }

    function resetSimulation() {
      simulationEvents = [];
      return rebuild();
    }

    return {
      get state() { return state; },
      get model() { return model; },
      snapshot,
      play,
      pause,
      restart,
      setTime,
      setSpeed,
      advance,
      tick,
      selectVehicle,
      setFollow,
      escapeFollow,
      handleVisibility,
      injectDelay,
      undoDelay,
      resetSimulation,
    };
  }

  return {
    VEHICLE_STATUS,
    SPEEDS,
    timeToMinutes,
    timeText,
    buildRouteSchedule,
    buildReplayModel,
    vehicleStateAt,
    stateAt,
    replayEvents,
    interpolateLongitude,
    interpolateCoordinate,
    bearing,
    createReplayController,
  };
});
