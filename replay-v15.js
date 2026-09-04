(function (root, factory) {
  "use strict";
  const base = root?.STCTReplay || (typeof require === "function" ? require("./replay-v14.js") : null);
  const simulation = root?.STCTSimulationStoreFactory || (typeof require === "function" ? require("./simulation-store-v15.js") : null);
  const experience = root?.STCTExperience || null;
  const api = factory(base, simulation, experience);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.replay = api;
    root.STCTReplayV15 = api;
    root.STCTReplay = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Base, Simulation, GlobalExperience) {
  "use strict";

  if (!Base || !Simulation) throw new Error("STCT Replay v1.5 requires Replay v1.4 facts and SimulationStore v1.5.");

  const VERSION = "stct-replay-v1.5.1";
  const VEHICLE_SCOPES = Object.freeze(["ALL", "SINGLE"]);
  const EVENT_FILTERS = Object.freeze(["ALL", "EXCEPTION", "SELECTED_VEHICLE"]);
  const EXCEPTION_TYPES = new Set(["SIMULATED_DELAY", "WINDOW_AT_RISK", "WINDOW_MISSED", "INCIDENT", "RECOVERY"]);
  const EVENT_WINDOW_LIMIT = 200;

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
    return Simulation?.stableStringify ? text(left).localeCompare(text(right)) : text(left).localeCompare(text(right));
  }

  function fnv1a(value) {
    let hash = 0x811c9dc5;
    const bytes = new TextEncoder().encode(String(value));
    bytes.forEach((byte) => {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    });
    return hash.toString(16).padStart(8, "0");
  }

  function eventId(event) {
    return `RPEVT-${fnv1a(Simulation.stableStringify({ minute: event.minute, routeId: event.routeId, vehicleId: event.vehicleId, orderId: event.orderId, type: event.type }))}`;
  }

  function allReplayEvents(model) {
    const rows = Base.replayEvents(model).map((event) => ({ ...event, eventId: eventId(event), exception: EXCEPTION_TYPES.has(event.type) }));
    model.schedules.forEach((route) => {
      route.stops.forEach((stop) => {
        if (!stop.atRisk && !stop.missedWindow) return;
        const type = stop.missedWindow ? "WINDOW_MISSED" : "WINDOW_AT_RISK";
        const event = {
          minute: stop.serviceStartMinute,
          routeId: route.routeId,
          vehicleId: route.vehicleId,
          orderId: stop.orderId,
          type,
          label: `${type} · ${stop.code || stop.orderId}`,
          exception: true,
        };
        rows.push({ ...event, eventId: eventId(event) });
      });
    });
    return rows.sort((left, right) => left.minute - right.minute
      || compare(left.vehicleId, right.vehicleId)
      || compare(left.type, right.type)
      || compare(left.orderId, right.orderId)
      || compare(left.eventId, right.eventId));
  }

  function filterReplayEvents(events, filter, selectedVehicleId) {
    const selectedFilter = EVENT_FILTERS.includes(filter) ? filter : "ALL";
    if (selectedFilter === "EXCEPTION") return events.filter((event) => event.exception || EXCEPTION_TYPES.has(event.type));
    if (selectedFilter === "SELECTED_VEHICLE") return events.filter((event) => event.vehicleId === text(selectedVehicleId));
    return events;
  }

  function routeSummary(model, vehicleId) {
    const route = model.schedules.find((candidate) => candidate.vehicleId === text(vehicleId)) || null;
    if (!route) return null;
    const travelMinutes = route.stops.reduce((sum, stop) => sum + stop.travelMin, 0) + route.returnTravelMin;
    const waitingMinutes = route.stops.reduce((sum, stop) => sum + stop.waitingMin, 0);
    const serviceMinutes = route.stops.reduce((sum, stop) => sum + stop.serviceMin, 0);
    return {
      routeId: route.routeId,
      vehicleId: route.vehicleId,
      distanceKm: number(route.routeDistanceKm, route.stops.length * 8),
      plannedDurationMinutes: route.returnMinute - route.startMinute,
      travelMinutes,
      waitingMinutes,
      serviceMinutes,
      delayedMinutes: route.delayedMinutes,
      stopCount: route.stops.length,
    };
  }

  function createReplayController(plan, scenario, options = {}) {
    const store = options.simulationStore || GlobalExperience?.simulationStore;
    const eventStore = options.eventStore || GlobalExperience?.eventStore || null;
    if (!store || typeof store.snapshot !== "function" || typeof store.addEvent !== "function") {
      const error = new Error("Replay v1.5 requires the shared SimulationStore.");
      error.code = "SIMULATION_STORE_REQUIRED";
      throw error;
    }
    const initialStore = store.snapshot();
    if (initialStore.activePlanHash && initialStore.activePlanHash !== text(plan?.planHash)) {
      const error = new Error("Replay planHash does not match SimulationStore activePlanHash.");
      error.code = "REPLAY_SIMULATION_PLAN_MISMATCH";
      throw error;
    }
    let destroyed = false;
    let storeSnapshot = initialStore;
    let model = Base.buildReplayModel(plan, scenario, { ...options, simulationEvents: initialStore.activeEvents || [] });
    let replayEventCache = allReplayEvents(model);
    let state = {
      version: VERSION,
      status: "idle",
      currentMinute: model.startMinute,
      startMinute: model.startMinute,
      endMinute: model.endMinute,
      speed: Base.SPEEDS.includes(number(options.speed)) ? number(options.speed) : 1,
      vehicleScope: VEHICLE_SCOPES.includes(options.vehicleScope) ? options.vehicleScope : "SINGLE",
      selectedVehicleId: text(options.selectedVehicleId || model.schedules[0]?.vehicleId),
      selectedOrderId: text(options.selectedOrderId),
      selectedEventId: "",
      eventFilter: EVENT_FILTERS.includes(options.eventFilter) ? options.eventFilter : "ALL",
      followVehicle: Boolean(options.followVehicle),
      stopMarkersVisible: options.stopMarkersVisible !== false,
      reducedMotion: Boolean(options.reducedMotion),
      webglAvailable: options.webglAvailable !== false,
      pausedByVisibility: false,
      simulationRevision: initialStore.simulationRevision,
    };
    if (state.vehicleScope === "ALL") state.followVehicle = false;

    function ensureActive() {
      if (destroyed) throw new Error("Replay v1.5 controller has been destroyed.");
    }

    function rebuild(nextStoreSnapshot = store.snapshot()) {
      ensureActive();
      if (nextStoreSnapshot.activePlanHash !== model.planHash) {
        const error = new Error("SimulationStore changed plans; recreate Replay controller with the active verified plan.");
        error.code = "REPLAY_PLAN_RELOAD_REQUIRED";
        throw error;
      }
      storeSnapshot = nextStoreSnapshot;
      model = Base.buildReplayModel(plan, scenario, { ...options, simulationEvents: storeSnapshot.activeEvents, reducedMotion: state.reducedMotion, webglAvailable: state.webglAvailable });
      replayEventCache = allReplayEvents(model);
      state.startMinute = model.startMinute;
      state.endMinute = model.endMinute;
      state.currentMinute = clamp(state.currentMinute, model.startMinute, model.endMinute);
      state.simulationRevision = storeSnapshot.simulationRevision;
      return snapshot();
    }

    const unsubscribe = store.subscribe((event) => {
      if (destroyed || event.state.activePlanHash !== model.planHash) return;
      rebuild(event.state);
    });

    function snapshot() {
      ensureActive();
      const baseFrame = Base.stateAt(model, state.currentMinute, state.selectedVehicleId);
      const occurred = replayEventCache.filter((event) => event.minute <= state.currentMinute);
      const filtered = filterReplayEvents(occurred, state.eventFilter, state.selectedVehicleId);
      const visible = filtered.slice(-EVENT_WINDOW_LIMIT);
      const selected = replayEventCache.find((event) => event.eventId === state.selectedEventId) || null;
      return {
        ...clone(state),
        simulationEvents: clone(storeSnapshot.activeEvents),
        frame: {
          ...baseFrame,
          events: visible,
          eventCountBeforeWindow: Math.max(0, filtered.length - visible.length),
          vehicleScope: state.vehicleScope,
          selectedEvent: clone(selected),
          fleetSummary: {
            vehicles: baseFrame.vehicles.length,
            activeVehicles: baseFrame.fleetPulse.activeVehicles,
            completedStops: baseFrame.fleetPulse.completedStops,
            totalStops: baseFrame.fleetPulse.totalStops,
            atRiskStops: baseFrame.fleetPulse.atRiskStops,
            delayedMinutes: baseFrame.fleetPulse.delayedMinutes,
          },
          routeSummary: routeSummary(model, state.selectedVehicleId),
        },
      };
    }

    function play() {
      ensureActive();
      if (state.currentMinute >= state.endMinute) state.currentMinute = state.startMinute;
      state.status = "playing";
      state.pausedByVisibility = false;
      return snapshot();
    }

    function pause() {
      ensureActive();
      if (state.status === "playing") state.status = "paused";
      return snapshot();
    }

    function restart() {
      ensureActive();
      state.currentMinute = state.startMinute;
      state.status = "idle";
      state.pausedByVisibility = false;
      state.selectedEventId = "";
      return snapshot();
    }

    function setTime(minute) {
      ensureActive();
      state.currentMinute = clamp(number(minute, state.startMinute), state.startMinute, state.endMinute);
      if (state.currentMinute >= state.endMinute) state.status = "ended";
      else if (state.status === "ended") state.status = "paused";
      return snapshot();
    }

    function setSpeed(speed) {
      ensureActive();
      const value = number(speed);
      if (!Base.SPEEDS.includes(value)) throw new Error(`Unsupported replay speed: ${speed}`);
      state.speed = value;
      return snapshot();
    }

    function advance(elapsedMilliseconds) {
      ensureActive();
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

    function setVehicleScope(scope) {
      ensureActive();
      const selected = text(scope).toUpperCase();
      if (!VEHICLE_SCOPES.includes(selected)) throw new Error(`Unsupported vehicle scope: ${scope}`);
      state.vehicleScope = selected;
      if (selected === "ALL") {
        state.followVehicle = false;
        if (state.eventFilter === "SELECTED_VEHICLE") state.eventFilter = "ALL";
      }
      return snapshot();
    }

    function selectVehicle(vehicleId) {
      ensureActive();
      if (text(vehicleId).toUpperCase() === "ALL") return setVehicleScope("ALL");
      if (!model.schedules.some((route) => route.vehicleId === text(vehicleId))) throw new Error(`Unknown replay vehicle: ${vehicleId}`);
      state.selectedVehicleId = text(vehicleId);
      state.vehicleScope = "SINGLE";
      return snapshot();
    }

    function setEventFilter(filter) {
      ensureActive();
      const selected = text(filter).toUpperCase();
      if (!EVENT_FILTERS.includes(selected)) throw new Error(`Unsupported event filter: ${filter}`);
      if (selected === "SELECTED_VEHICLE" && state.vehicleScope === "ALL") {
        const error = new Error("Select one vehicle before using SELECTED_VEHICLE filter.");
        error.code = "SELECTED_VEHICLE_FILTER_REQUIRES_SINGLE_SCOPE";
        throw error;
      }
      state.eventFilter = selected;
      return snapshot();
    }

    function setFollow(value) {
      ensureActive();
      state.followVehicle = state.vehicleScope === "SINGLE" && Boolean(value);
      return snapshot();
    }

    function escapeFollow() {
      ensureActive();
      state.followVehicle = false;
      return snapshot();
    }

    function setStopMarkersVisible(value) {
      ensureActive();
      state.stopMarkersVisible = Boolean(value);
      return snapshot();
    }

    function handleVisibility(hidden) {
      ensureActive();
      if (hidden && state.status === "playing") {
        state.status = "paused";
        state.pausedByVisibility = true;
      } else if (!hidden) state.pausedByVisibility = false;
      return snapshot();
    }

    async function injectDelay(event) {
      ensureActive();
      const minutes = Math.max(0, Math.round(number(event?.minutes)));
      if (![15, 30, 60].includes(minutes)) throw new Error("Replay delay must be +15, +30 or +60 minutes.");
      const route = model.schedules.find((candidate) => candidate.routeId === text(event?.routeId));
      const stop = route?.stops.find((candidate) => candidate.orderId === text(event?.orderId));
      if (!route || !stop) throw new Error("Replay delay requires a stop in the selected route.");
      const result = await store.addEvent({
        eventId: text(event.eventId),
        type: "DELAY",
        routeId: route.routeId,
        vehicleId: route.vehicleId,
        orderId: stop.orderId,
        stopIndex: stop.seq - 1,
        minutes,
        source: text(event.source || "replay-ui"),
      }, { source: text(event.source || "replay-ui") });
      rebuild(result.snapshot);
      return snapshot();
    }

    async function undoDelay() {
      ensureActive();
      const result = await store.undo({ source: "replay-ui" });
      rebuild(result.snapshot);
      return snapshot();
    }

    async function redoDelay() {
      ensureActive();
      const result = await store.redo({ source: "replay-ui" });
      rebuild(result.snapshot);
      return snapshot();
    }

    async function resetSimulation() {
      ensureActive();
      const result = await store.reset({ source: "replay-ui" });
      rebuild(result.snapshot);
      return snapshot();
    }

    function jumpToEvent(targetEventId) {
      ensureActive();
      const event = replayEventCache.find((candidate) => candidate.eventId === text(targetEventId));
      if (!event) {
        const error = new Error(`Unknown replay event: ${targetEventId}`);
        error.code = "REPLAY_EVENT_NOT_FOUND";
        throw error;
      }
      pause();
      state.status = "paused";
      state.currentMinute = clamp(event.minute, state.startMinute, state.endMinute);
      state.selectedVehicleId = event.vehicleId || state.selectedVehicleId;
      state.selectedOrderId = event.orderId || "";
      state.selectedEventId = event.eventId;
      state.vehicleScope = "SINGLE";
      state.followVehicle = false;
      return { ...snapshot(), jump: clone(event) };
    }

    function eventLane(filter = {}) {
      ensureActive();
      return eventStore?.filter ? eventStore.filter(filter) : [];
    }

    function destroy() {
      if (destroyed) return;
      unsubscribe();
      destroyed = true;
    }

    return {
      get state() { return clone(state); },
      get model() { return model; },
      get simulationStore() { return store; },
      get eventStore() { return eventStore; },
      VERSION,
      snapshot,
      play,
      pause,
      restart,
      setTime,
      setSpeed,
      advance,
      tick,
      selectVehicle,
      setVehicleScope,
      setEventFilter,
      setFollow,
      escapeFollow,
      setStopMarkersVisible,
      handleVisibility,
      injectDelay,
      undoDelay,
      redoDelay,
      resetSimulation,
      jumpToEvent,
      eventLane,
      destroy,
    };
  }

  return {
    ...Base,
    VERSION,
    VEHICLE_SCOPES,
    EVENT_FILTERS,
    EXCEPTION_TYPES,
    EVENT_WINDOW_LIMIT,
    allReplayEvents,
    filterReplayEvents,
    routeSummary,
    createReplayController,
  };
});
