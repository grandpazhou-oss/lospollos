(function (root, factory) {
  "use strict";
  const experience = root?.STCTExperienceFactory || (typeof require === "function" ? require("./experience-v14.js") : null);
  const replay = root?.STCTReplay || (typeof require === "function" ? require("./replay-v14.js") : null);
  const api = factory(experience, replay);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.STCTTimeline = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Experience, Replay) {
  "use strict";

  const LENSES = Object.freeze(["time-window", "capacity", "priority", "diagnostic"]);
  const BLOCK_TYPES = Object.freeze({
    TRAVEL: "TRAVEL",
    WAITING: "WAITING",
    SERVICE: "SERVICE",
    SIMULATED_DELAY: "SIMULATED_DELAY",
    RETURN: "RETURN",
    LUNCH_BREAK: "LUNCH_BREAK",
    OVERTIME: "OVERTIME",
  });
  const CAPACITY_NOTICE = "Capacity utilization, not packing layout";

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

  function compare(left, right) {
    if (Experience?.utf8Compare) return Experience.utf8Compare(left, right);
    return text(left).localeCompare(text(right));
  }

  function routeMap(plan) {
    return new Map((plan?.routes || []).map((route) => [text(route.routeId), route]));
  }

  function assignmentMap(plan) {
    const result = new Map();
    (plan?.routes || []).forEach((route) => {
      (route.orderIds || []).forEach((orderId, index) => result.set(text(orderId), { routeId: text(route.routeId), vehicleId: text(route.vehicleId), seq: index + 1 }));
    });
    return result;
  }

  function normalizeTime(value, start) {
    let minute = Replay.timeToMinutes(value, start);
    while (minute < start) minute += 24 * 60;
    return minute;
  }

  function buildBlocks(schedule, constraints = {}) {
    const blocks = [];
    schedule.stops.forEach((stop) => {
      if (stop.travelEndMinute > stop.travelStartMinute) blocks.push({ type: BLOCK_TYPES.TRAVEL, startMinute: stop.travelStartMinute, endMinute: stop.travelEndMinute, routeId: schedule.routeId, vehicleId: schedule.vehicleId, orderId: stop.orderId });
      if (stop.delayEndMinute > stop.delayStartMinute) blocks.push({ type: BLOCK_TYPES.SIMULATED_DELAY, startMinute: stop.delayStartMinute, endMinute: stop.delayEndMinute, routeId: schedule.routeId, vehicleId: schedule.vehicleId, orderId: stop.orderId, minutes: stop.eventDelayMin });
      if (stop.serviceStartMinute > stop.rawArrivalMinute) blocks.push({ type: BLOCK_TYPES.WAITING, startMinute: stop.rawArrivalMinute, endMinute: stop.serviceStartMinute, routeId: schedule.routeId, vehicleId: schedule.vehicleId, orderId: stop.orderId, minutes: stop.waitingMin });
      blocks.push({ type: BLOCK_TYPES.SERVICE, startMinute: stop.serviceStartMinute, endMinute: stop.departureMinute, routeId: schedule.routeId, vehicleId: schedule.vehicleId, orderId: stop.orderId, priority: stop.priority, slackMin: stop.slackMin, atRisk: stop.atRisk, missedWindow: stop.missedWindow });
    });
    if (schedule.returnMinute > schedule.returnStartMinute) blocks.push({ type: BLOCK_TYPES.RETURN, startMinute: schedule.returnStartMinute, endMinute: schedule.returnMinute, routeId: schedule.routeId, vehicleId: schedule.vehicleId, orderId: "DEPOT" });
    const lunchStart = text(constraints.lunchStart) ? normalizeTime(constraints.lunchStart, schedule.startMinute) : null;
    const lunchEnd = text(constraints.lunchEnd) ? normalizeTime(constraints.lunchEnd, schedule.startMinute) : null;
    if (lunchStart !== null && lunchEnd > lunchStart) blocks.push({ type: BLOCK_TYPES.LUNCH_BREAK, startMinute: lunchStart, endMinute: lunchEnd, routeId: schedule.routeId, vehicleId: schedule.vehicleId, orderId: "" });
    if (schedule.returnMinute > schedule.shiftEndMinute) blocks.push({ type: BLOCK_TYPES.OVERTIME, startMinute: schedule.shiftEndMinute, endMinute: schedule.returnMinute, routeId: schedule.routeId, vehicleId: schedule.vehicleId, orderId: "" });
    return blocks.sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute || compare(left.type, right.type));
  }

  function buildTimeline(plan, scenario, options = {}) {
    const replayModel = Replay.buildReplayModel(plan, scenario, {
      simulationEvents: options.simulationEvents || [],
      webglAvailable: options.webglAvailable,
      reducedMotion: options.reducedMotion,
    });
    const locked = new Set((options.lockedRouteIds || []).map(text));
    const constraints = scenario?.constraintsSnapshot || {};
    const lanes = replayModel.schedules.map((schedule) => ({
      routeId: schedule.routeId,
      vehicleId: schedule.vehicleId,
      vehicleName: schedule.vehicleName,
      locked: locked.has(schedule.routeId),
      shiftStartMinute: schedule.startMinute,
      shiftEndMinute: schedule.shiftEndMinute,
      returnMinute: schedule.returnMinute,
      stops: clone(schedule.stops),
      blocks: buildBlocks(schedule, constraints),
      timeWindows: schedule.stops.map((stop) => ({ orderId: stop.orderId, startMinute: stop.windowStartMinute, endMinute: stop.windowEndMinute, slackMin: stop.slackMin, missedWindow: stop.missedWindow })),
    }));
    return {
      version: "stct-timeline-v1.4",
      scenarioId: replayModel.scenarioId,
      inputHash: replayModel.inputHash,
      planHash: replayModel.planHash,
      startMinute: replayModel.startMinute,
      endMinute: replayModel.endMinute,
      replayCursorMinute: number(options.replayCursorMinute, replayModel.startMinute),
      activeLens: LENSES.includes(options.activeLens) ? options.activeLens : "time-window",
      lanes,
      webglAvailable: options.webglAvailable !== false,
      reducedMotion: Boolean(options.reducedMotion),
    };
  }

  function capacityProfile(plan, scenario, routeId, options = {}) {
    const model = Replay.buildReplayModel(plan, scenario, options);
    const route = model.schedules.find((candidate) => candidate.routeId === text(routeId));
    if (!route) throw new Error(`Unknown capacity profile route: ${routeId}`);
    const maxVolume = Math.max(0, number(route.maxVolume));
    const maxWeight = Math.max(0, number(route.maxWeight));
    const points = [{
      seq: 0,
      orderId: "DEPOT",
      remainingVolume: route.initialVolume,
      remainingWeight: route.initialWeight,
      remainingVolumePercent: maxVolume ? route.initialVolume / maxVolume * 100 : 0,
      remainingWeightPercent: maxWeight ? route.initialWeight / maxWeight * 100 : 0,
      deliveredVolume: 0,
      deliveredWeight: 0,
    }];
    let deliveredVolume = 0;
    let deliveredWeight = 0;
    route.stops.forEach((stop) => {
      deliveredVolume += stop.volume;
      deliveredWeight += stop.weight;
      points.push({
        seq: stop.seq,
        orderId: stop.orderId,
        remainingVolume: Math.max(0, route.initialVolume - deliveredVolume),
        remainingWeight: Math.max(0, route.initialWeight - deliveredWeight),
        remainingVolumePercent: maxVolume ? Math.max(0, route.initialVolume - deliveredVolume) / maxVolume * 100 : 0,
        remainingWeightPercent: maxWeight ? Math.max(0, route.initialWeight - deliveredWeight) / maxWeight * 100 : 0,
        deliveredVolume: stop.volume,
        deliveredWeight: stop.weight,
      });
    });
    const deliveredVolumeTotal = points.slice(1).reduce((sum, point) => sum + point.deliveredVolume, 0);
    const deliveredWeightTotal = points.slice(1).reduce((sum, point) => sum + point.deliveredWeight, 0);
    return {
      routeId: route.routeId,
      vehicleId: route.vehicleId,
      notice: CAPACITY_NOTICE,
      maxVolume,
      maxWeight,
      initialVolume: route.initialVolume,
      initialWeight: route.initialWeight,
      volumeConserved: Math.abs(route.initialVolume - deliveredVolumeTotal - points.at(-1).remainingVolume) < 1e-9,
      weightConserved: Math.abs(route.initialWeight - deliveredWeightTotal - points.at(-1).remainingWeight) < 1e-9,
      points,
    };
  }

  function timeWindowLens(timeline) {
    return timeline.lanes.flatMap((lane) => lane.stops.map((stop) => ({
      routeId: lane.routeId,
      orderId: stop.orderId,
      slackMin: stop.slackMin,
      waitingMin: stop.waitingMin,
      status: stop.missedWindow ? "MISSED_WINDOW" : stop.atRisk ? "AT_RISK" : stop.waitingMin > 0 ? "WAITING" : "ON_TIME",
      overtime: lane.returnMinute > lane.shiftEndMinute,
    })));
  }

  function capacityLens(plan, scenario, options = {}) {
    return (plan?.routes || []).map((route) => {
      const profile = capacityProfile(plan, scenario, route.routeId, options);
      return {
        routeId: text(route.routeId),
        volumeUtilization: number(route.volumeUtilization),
        weightUtilization: number(route.weightUtilization),
        pressure: Math.max(number(route.volumeUtilization), number(route.weightUtilization)) >= 90 ? "HIGH" : Math.max(number(route.volumeUtilization), number(route.weightUtilization)) >= 70 ? "MEDIUM" : "NORMAL",
        profile,
      };
    });
  }

  function priorityLens(plan, scenario) {
    const assignments = assignmentMap(plan);
    const unassigned = new Set((plan?.unassignedOrderIds || []).map(text));
    return (scenario?.orders || []).map((order) => {
      const orderId = text(order.id || order.orderId || order.code);
      const assignment = assignments.get(orderId) || null;
      return {
        orderId,
        priority: text(order.priority || "normal"),
        priorityWeight: number(order.priorityWeight, 1),
        assigned: Boolean(assignment),
        unassigned: unassigned.has(orderId),
        routeId: assignment?.routeId || "",
        severity: text(order.priority) === "high" && !assignment ? "HIGH_PRIORITY_UNASSIGNED" : text(order.priority || "normal").toUpperCase(),
      };
    });
  }

  function diagnosticLens(plan, scenario) {
    const availableVehicles = scenario?.vehicles?.length || 0;
    const usedVehicles = plan?.verification?.recomputedMetrics?.usedVehicles || 0;
    const unassignedRows = plan?.unassignedOrders || [];
    return {
      scenarioPressure: {
        orders: scenario?.orders?.length || 0,
        availableVehicles,
        usedVehicles,
        fleetSaturated: availableVehicles > 0 && usedVehicles >= availableVehicles,
        confidence: "deterministic",
      },
      orders: unassignedRows.map((order) => ({
        orderId: text(order.id || order.orderId || order.code),
        reasonCode: text(order.reasonCode || "UNASSIGNED_UNKNOWN"),
        confidence: ["deterministic", "probable", "unknown"].includes(text(order.confidence)) ? text(order.confidence) : "unknown",
        evidence: clone(order.evidence || {}),
      })),
    };
  }

  function lensData(lens, plan, scenario, timeline, options = {}) {
    if (lens === "time-window") return timeWindowLens(timeline);
    if (lens === "capacity") return capacityLens(plan, scenario, options);
    if (lens === "priority") return priorityLens(plan, scenario);
    if (lens === "diagnostic") return diagnosticLens(plan, scenario);
    throw new Error(`Unknown constraint lens: ${lens}`);
  }

  function xrayGeoJson(plan, scenario, lens, options = {}) {
    const timeline = buildTimeline(plan, scenario, { ...options, activeLens: lens });
    const stopData = new Map();
    if (lens === "time-window") timeWindowLens(timeline).forEach((row) => stopData.set(row.orderId, row));
    if (lens === "priority") priorityLens(plan, scenario).forEach((row) => stopData.set(row.orderId, row));
    const routeData = new Map();
    if (lens === "capacity") capacityLens(plan, scenario, options).forEach((row) => routeData.set(row.routeId, { pressure: row.pressure, volumeUtilization: row.volumeUtilization, weightUtilization: row.weightUtilization }));
    return {
      routes: {
        type: "FeatureCollection",
        features: (plan?.routeGeoJson?.features || []).map((feature) => ({ ...clone(feature), properties: { ...(feature.properties || {}), xrayLens: lens, ...(routeData.get(text(feature.properties?.routeId)) || {}) } })),
      },
      stops: {
        type: "FeatureCollection",
        features: (plan?.stopGeoJson?.features || []).map((feature) => ({ ...clone(feature), properties: { ...(feature.properties || {}), xrayLens: lens, ...(stopData.get(text(feature.properties?.orderId)) || {}) } })),
      },
    };
  }

  function buildMoveCommand({ orderId, targetRouteId, insertMode, anchorOrderId = "", source = "timeline" } = {}) {
    const mode = text(insertMode).toUpperCase();
    if (!text(orderId) || !text(targetRouteId)) throw new Error("Move requires orderId and targetRouteId.");
    if (!["APPEND", "AFTER", "BEFORE", "AUTO_MIN_DELTA"].includes(mode)) throw new Error("Move requires an explicit insertion mode.");
    if (["AFTER", "BEFORE"].includes(mode) && !text(anchorOrderId)) throw new Error(`${mode} requires anchorOrderId.`);
    return { actionType: "MOVE_ORDER", payload: { orderId: text(orderId), toRouteId: text(targetRouteId), insertMode: mode, anchorOrderId: text(anchorOrderId), source: text(source) } };
  }

  function buildUnassignedCommand({ orderId, targetRouteId, insertMode, anchorOrderId = "", source = "timeline-mobile" } = {}) {
    const command = buildMoveCommand({ orderId, targetRouteId, insertMode, anchorOrderId, source });
    return { actionType: "ADD_UNASSIGNED", payload: command.payload };
  }

  async function manualTransaction(planning, actionType, payload = {}) {
    if (!planning?.state) throw new Error("Planning API is unavailable.");
    if (!planning.state.manual?.active) await planning.startManual();
    const beforePlanHash = text(planning.state.manual?.plan?.planHash || planning.currentCandidate?.()?.planHash);
    try {
      let plan;
      if (actionType === "UNDO") plan = await planning.undoManual();
      else if (actionType === "RESTORE_SOLVER") plan = await planning.resetManual();
      else plan = await planning.manualAction(actionType, payload);
      const afterPlanHash = text(plan?.planHash || planning.state.manual?.plan?.planHash || beforePlanHash);
      return { status: "COMMIT", actionType, beforePlanHash, afterPlanHash, plan, verifierCode: "PASS" };
    } catch (error) {
      const afterPlanHash = text(planning.state.manual?.plan?.planHash || planning.currentCandidate?.()?.planHash);
      return { status: "ROLLBACK", actionType, beforePlanHash, afterPlanHash, plan: planning.state.manual?.plan || null, verifierCode: text(error.code || error.verification?.hardViolations?.[0]?.code || "MANUAL_EDIT_REJECTED"), message: error.message };
    }
  }

  function createSelectionBridge({ onMapFocus, onTimelineFocus } = {}) {
    let source = "";
    return {
      fromTimeline(selection) {
        if (source === "map") return false;
        source = "timeline";
        try { onMapFocus?.(clone(selection)); } finally { source = ""; }
        return true;
      },
      fromMap(selection) {
        if (source === "timeline") return false;
        source = "map";
        try { onTimelineFocus?.(clone(selection)); } finally { source = ""; }
        return true;
      },
    };
  }

  function createTimelineController(plan, scenario, options = {}) {
    let state = {
      activeLens: LENSES.includes(options.activeLens) ? options.activeLens : "time-window",
      selectedRouteId: text(options.selectedRouteId || plan?.routes?.[0]?.routeId),
      selectedOrderId: text(options.selectedOrderId),
      replayCursorMinute: number(options.replayCursorMinute),
      editMode: false,
      reducedMotion: Boolean(options.reducedMotion),
      webglAvailable: options.webglAvailable !== false,
      planHash: text(plan?.planHash),
    };
    function snapshot() {
      const timeline = buildTimeline(plan, scenario, { ...options, activeLens: state.activeLens, replayCursorMinute: state.replayCursorMinute, webglAvailable: state.webglAvailable, reducedMotion: state.reducedMotion });
      return { ...clone(state), transitionMs: state.reducedMotion ? 0 : 180, timeline, lens: lensData(state.activeLens, plan, scenario, timeline, options), capacityProfile: state.selectedRouteId ? capacityProfile(plan, scenario, state.selectedRouteId, options) : null };
    }
    function setLens(lens) {
      if (!LENSES.includes(lens)) throw new Error(`Unknown constraint lens: ${lens}`);
      state.activeLens = lens;
      return snapshot();
    }
    function selectRoute(routeId) {
      if (!(plan?.routes || []).some((route) => text(route.routeId) === text(routeId))) throw new Error(`Unknown timeline route: ${routeId}`);
      state.selectedRouteId = text(routeId);
      state.selectedOrderId = "";
      return snapshot();
    }
    function selectStop(orderId) {
      const assignment = assignmentMap(plan).get(text(orderId));
      if (!assignment) throw new Error(`Unknown timeline stop: ${orderId}`);
      state.selectedOrderId = text(orderId);
      state.selectedRouteId = assignment.routeId;
      return snapshot();
    }
    function setReplayCursor(minute) {
      state.replayCursorMinute = number(minute);
      return snapshot();
    }
    function setEditMode(value) {
      state.editMode = Boolean(value);
      return snapshot();
    }
    return { get state() { return state; }, snapshot, setLens, selectRoute, selectStop, setReplayCursor, setEditMode };
  }

  return {
    LENSES,
    BLOCK_TYPES,
    CAPACITY_NOTICE,
    buildBlocks,
    buildTimeline,
    capacityProfile,
    timeWindowLens,
    capacityLens,
    priorityLens,
    diagnosticLens,
    lensData,
    xrayGeoJson,
    buildMoveCommand,
    buildUnassignedCommand,
    manualTransaction,
    createSelectionBridge,
    createTimelineController,
  };
});
