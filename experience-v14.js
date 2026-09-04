(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTExperienceFactory = api;
    if (!root.STCTExperience) {
      root.STCTExperience = api.createExperience({
        eventTarget: typeof root.dispatchEvent === "function" ? root : null,
      });
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MODES = Object.freeze(["replay", "arena", "timeline", "director"]);
  const EVENT_NAMES = Object.freeze({
    open: "stct:experience-open",
    close: "stct:experience-close",
    planSelected: "stct:experience-plan-selected",
    replayTime: "stct:replay-time-change",
    replayVehicle: "stct:replay-vehicle-selected",
    arenaSelection: "stct:arena-selection-change",
    timelineStop: "stct:timeline-stop-selected",
    manualPlan: "stct:manual-plan-updated",
    mode: "stct:experience-mode-change",
    simulation: "stct:experience-simulation-change",
  });
  const IDENTITY_FIELDS = Object.freeze([
    "contentHash",
    "inputHash",
    "requestHash",
    "planHash",
    "manualRevision",
  ]);

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

  function utf8Compare(left, right) {
    const a = new TextEncoder().encode(text(left));
    const b = new TextEncoder().encode(text(right));
    const length = Math.min(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      if (a[index] !== b[index]) return a[index] - b[index];
    }
    return a.length - b.length;
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
      return Object.keys(value).sort(utf8Compare).reduce((result, key) => {
        result[key] = stableValue(value[key]);
        return result;
      }, {});
    }
    return value;
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  async function sha256(input) {
    const source = String(input);
    if (typeof crypto !== "undefined" && crypto.subtle && typeof TextEncoder !== "undefined") {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
      return `sha256:${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    }
    if (typeof require === "function") {
      const nodeCrypto = require("crypto");
      return `sha256:${nodeCrypto.createHash("sha256").update(source, "utf8").digest("hex")}`;
    }
    throw new Error("SHA-256 is unavailable in this environment.");
  }

  function verifiedMetrics(plan) {
    if (!plan || plan.verification?.status !== "PASS") return null;
    return plan.verification.recomputedMetrics || null;
  }

  function verifyPlanShape(plan, scenario) {
    const reasons = [];
    if (!scenario || !text(scenario.inputHash)) reasons.push("MISSING_CANONICAL_SCENARIO");
    if (!plan) reasons.push("MISSING_VERIFIED_PLAN");
    if (plan && plan.verification?.status !== "PASS") reasons.push("VERIFIER_NOT_PASS");
    if (plan && !text(plan.planHash)) reasons.push("MISSING_PLAN_HASH");
    if (plan && scenario && text(plan.inputHash) !== text(scenario.inputHash)) reasons.push("PLAN_INPUT_HASH_MISMATCH");
    if (plan && text(plan.verification?.computedPlanHash) && text(plan.planHash) !== text(plan.verification.computedPlanHash)) reasons.push("PLAN_HASH_MISMATCH");
    if (plan && !verifiedMetrics(plan)) reasons.push("MISSING_RECOMPUTED_METRICS");
    return { status: reasons.length ? "FAIL" : "PASS", reasons };
  }

  function planIdentity(plan, scenario) {
    return {
      contentHash: text(plan?.contentHash || scenario?.contentHash),
      inputHash: text(plan?.inputHash || scenario?.inputHash),
      requestHash: text(plan?.requestHash),
      planHash: text(plan?.planHash),
      manualRevision: number(plan?.manualRevision, 0),
    };
  }

  function identityEqual(left, right) {
    return IDENTITY_FIELDS.every((field) => left?.[field] === right?.[field]);
  }

  function normalizeSimulationEvent(event, sequence) {
    const minutes = Math.max(0, Math.round(number(event?.minutes)));
    return {
      eventId: text(event?.eventId || `SIM-${String(sequence).padStart(4, "0")}`),
      type: text(event?.type || "DELAY"),
      routeId: text(event?.routeId),
      orderId: text(event?.orderId),
      minutes,
      stopIndex: Math.max(0, Math.round(number(event?.stopIndex))),
      source: text(event?.source || "user-simulation"),
    };
  }

  function canonicalSimulationEvents(events) {
    return (events || []).map((event, index) => normalizeSimulationEvent(event, index + 1)).sort((left, right) => (
      utf8Compare(left.routeId, right.routeId)
      || left.stopIndex - right.stopIndex
      || utf8Compare(left.orderId, right.orderId)
      || left.minutes - right.minutes
      || utf8Compare(left.eventId, right.eventId)
    ));
  }

  async function simulationIdentity(planHash, events, hash = sha256) {
    return hash(stableStringify({
      version: "stct-simulation-v1",
      planHash: text(planHash),
      simulationEvents: canonicalSimulationEvents(events),
    }));
  }

  function initialState(options = {}) {
    return {
      opened: false,
      activeMode: "replay",
      scenarioId: "",
      inputHash: "",
      activePlanHash: "",
      verifiedPlan: null,
      recomputedMetrics: null,
      comparisonLeftPlanHash: "",
      comparisonRightPlanHash: "",
      selectedVehicleId: "",
      selectedOrderId: "",
      replayState: null,
      timelineState: null,
      storyState: null,
      whatIfMetadata: [],
      manualLineage: [],
      simulationEvents: [],
      simulationHash: "",
      reducedMotion: Boolean(options.reducedMotion),
      webglAvailable: options.webglAvailable !== false,
      identity: null,
      openCount: 0,
    };
  }

  function createExperience(options = {}) {
    const eventTarget = options.eventTarget || null;
    const hash = options.hash || sha256;
    const internalListeners = new Map();
    const cleanups = new Map();
    let state = initialState(options);
    let destroyed = false;

    function ensureActive() {
      if (destroyed) throw new Error("Experience controller has been destroyed.");
    }

    function snapshot() {
      return clone(state);
    }

    function emit(name, detail = {}) {
      const payload = { ...clone(detail), state: snapshot() };
      (internalListeners.get(name) || new Set()).forEach((listener) => listener(payload));
      if (eventTarget && typeof eventTarget.dispatchEvent === "function" && typeof CustomEvent === "function") {
        eventTarget.dispatchEvent(new CustomEvent(name, { detail: payload }));
      }
      return payload;
    }

    function on(name, listener) {
      ensureActive();
      if (typeof listener !== "function") throw new Error("Experience listener must be a function.");
      if (!internalListeners.has(name)) internalListeners.set(name, new Set());
      internalListeners.get(name).add(listener);
      return () => off(name, listener);
    }

    function off(name, listener) {
      internalListeners.get(name)?.delete(listener);
    }

    function registerCleanup(owner, cleanup) {
      ensureActive();
      if (typeof cleanup !== "function") throw new Error("Cleanup must be a function.");
      const key = text(owner || "session");
      if (!cleanups.has(key)) cleanups.set(key, new Set());
      cleanups.get(key).add(cleanup);
      return () => cleanups.get(key)?.delete(cleanup);
    }

    function destroyOwner(owner) {
      const key = text(owner || "session");
      const owned = cleanups.get(key);
      if (!owned) return 0;
      let count = 0;
      [...owned].reverse().forEach((cleanup) => {
        cleanup();
        count += 1;
      });
      owned.clear();
      cleanups.delete(key);
      return count;
    }

    function assertIdentity(expected = state.identity) {
      const current = planIdentity(state.verifiedPlan, { inputHash: state.inputHash });
      if (!identityEqual(current, expected)) {
        const error = new Error("Experience action changed protected planning identity.");
        error.code = "EXPERIENCE_IDENTITY_MUTATION";
        error.expected = clone(expected);
        error.actual = current;
        throw error;
      }
      return current;
    }

    async function open(payload = {}) {
      ensureActive();
      const scenario = clone(payload.scenario);
      const plan = clone(payload.plan);
      const validation = verifyPlanShape(plan, scenario);
      if (validation.status !== "PASS") {
        const error = new Error(`Experience requires a verified plan: ${validation.reasons.join(", ")}`);
        error.code = validation.reasons[0] || "INVALID_EXPERIENCE_INPUT";
        error.reasons = validation.reasons;
        throw error;
      }
      if (state.opened) close({ reason: "reopen" });
      state = {
        ...initialState({ reducedMotion: payload.reducedMotion ?? state.reducedMotion, webglAvailable: payload.webglAvailable ?? state.webglAvailable }),
        opened: true,
        activeMode: MODES.includes(payload.mode) ? payload.mode : "replay",
        scenarioId: text(scenario.scenarioId),
        inputHash: text(scenario.inputHash),
        activePlanHash: text(plan.planHash),
        verifiedPlan: plan,
        recomputedMetrics: clone(verifiedMetrics(plan)),
        comparisonLeftPlanHash: text(payload.comparisonLeftPlanHash || plan.planHash),
        comparisonRightPlanHash: text(payload.comparisonRightPlanHash || plan.planHash),
        selectedVehicleId: text(payload.selectedVehicleId),
        selectedOrderId: text(payload.selectedOrderId),
        replayState: clone(payload.replayState || null),
        timelineState: clone(payload.timelineState || null),
        storyState: clone(payload.storyState || null),
        whatIfMetadata: clone(payload.whatIfMetadata || []),
        manualLineage: clone(payload.manualLineage || []),
        simulationEvents: canonicalSimulationEvents(payload.simulationEvents || []),
        simulationHash: "",
        reducedMotion: Boolean(payload.reducedMotion),
        webglAvailable: payload.webglAvailable !== false,
        identity: planIdentity(plan, scenario),
        openCount: state.openCount + 1,
      };
      state.simulationHash = await simulationIdentity(plan.planHash, state.simulationEvents, hash);
      assertIdentity();
      emit(EVENT_NAMES.open, { mode: state.activeMode, identity: state.identity });
      return snapshot();
    }

    function close(detail = {}) {
      ensureActive();
      if (!state.opened) return snapshot();
      assertIdentity();
      destroyOwner("session");
      const closedMode = state.activeMode;
      state.opened = false;
      state.replayState = null;
      state.timelineState = null;
      state.storyState = null;
      emit(EVENT_NAMES.close, { mode: closedMode, reason: text(detail.reason || "user") });
      return snapshot();
    }

    function setMode(mode) {
      ensureActive();
      if (!MODES.includes(mode)) throw new Error(`Unsupported experience mode: ${mode}`);
      assertIdentity();
      state.activeMode = mode;
      emit(EVENT_NAMES.mode, { mode });
      assertIdentity();
      return snapshot();
    }

    async function selectPlan(plan, scenario) {
      ensureActive();
      const canonicalScenario = clone(scenario || { inputHash: state.inputHash, scenarioId: state.scenarioId });
      const selected = clone(plan);
      const validation = verifyPlanShape(selected, canonicalScenario);
      if (validation.status !== "PASS") {
        const error = new Error(`Plan selection rejected: ${validation.reasons.join(", ")}`);
        error.code = validation.reasons[0] || "INVALID_PLAN_SELECTION";
        throw error;
      }
      state.verifiedPlan = selected;
      state.scenarioId = text(canonicalScenario.scenarioId || state.scenarioId);
      state.inputHash = text(canonicalScenario.inputHash);
      state.activePlanHash = text(selected.planHash);
      state.recomputedMetrics = clone(verifiedMetrics(selected));
      state.identity = planIdentity(selected, canonicalScenario);
      state.simulationEvents = [];
      state.simulationHash = await simulationIdentity(selected.planHash, [], hash);
      emit(EVENT_NAMES.planSelected, { planHash: selected.planHash, inputHash: selected.inputHash });
      assertIdentity();
      return snapshot();
    }

    function selectVehicle(vehicleId) {
      ensureActive();
      assertIdentity();
      state.selectedVehicleId = text(vehicleId);
      emit(EVENT_NAMES.replayVehicle, { vehicleId: state.selectedVehicleId });
      assertIdentity();
      return snapshot();
    }

    function selectOrder(orderId, source = "experience") {
      ensureActive();
      assertIdentity();
      state.selectedOrderId = text(orderId);
      emit(EVENT_NAMES.timelineStop, { orderId: state.selectedOrderId, source: text(source) });
      assertIdentity();
      return snapshot();
    }

    function setComparison(leftPlanHash, rightPlanHash) {
      ensureActive();
      assertIdentity();
      state.comparisonLeftPlanHash = text(leftPlanHash);
      state.comparisonRightPlanHash = text(rightPlanHash);
      emit(EVENT_NAMES.arenaSelection, { leftPlanHash: state.comparisonLeftPlanHash, rightPlanHash: state.comparisonRightPlanHash });
      assertIdentity();
      return snapshot();
    }

    function setReplayState(replayState) {
      ensureActive();
      assertIdentity();
      state.replayState = clone(replayState);
      emit(EVENT_NAMES.replayTime, { currentMinute: number(replayState?.currentMinute), replayState: clone(replayState) });
      assertIdentity();
      return snapshot();
    }

    function setTimelineState(timelineState) {
      ensureActive();
      assertIdentity();
      state.timelineState = clone(timelineState);
      assertIdentity();
      return snapshot();
    }

    function setStoryState(storyState) {
      ensureActive();
      assertIdentity();
      state.storyState = clone(storyState);
      assertIdentity();
      return snapshot();
    }

    async function addSimulationEvent(event) {
      ensureActive();
      assertIdentity();
      const normalized = normalizeSimulationEvent(event, state.simulationEvents.length + 1);
      if (!normalized.routeId || !normalized.orderId || !normalized.minutes) {
        const error = new Error("Simulation delay requires routeId, orderId and positive minutes.");
        error.code = "INVALID_SIMULATION_EVENT";
        throw error;
      }
      state.simulationEvents = canonicalSimulationEvents([...state.simulationEvents, normalized]);
      state.simulationHash = await simulationIdentity(state.activePlanHash, state.simulationEvents, hash);
      emit(EVENT_NAMES.simulation, { action: "ADD", event: normalized, simulationHash: state.simulationHash });
      assertIdentity();
      return snapshot();
    }

    async function undoSimulationEvent() {
      ensureActive();
      assertIdentity();
      const latestId = state.simulationEvents.at(-1)?.eventId;
      if (latestId) state.simulationEvents = state.simulationEvents.filter((event) => event.eventId !== latestId);
      state.simulationHash = await simulationIdentity(state.activePlanHash, state.simulationEvents, hash);
      emit(EVENT_NAMES.simulation, { action: "UNDO", eventId: latestId || "", simulationHash: state.simulationHash });
      assertIdentity();
      return snapshot();
    }

    async function resetSimulation() {
      ensureActive();
      assertIdentity();
      state.simulationEvents = [];
      state.simulationHash = await simulationIdentity(state.activePlanHash, [], hash);
      emit(EVENT_NAMES.simulation, { action: "RESET", simulationHash: state.simulationHash });
      assertIdentity();
      return snapshot();
    }

    function updateManualPlan(plan, scenario, lineage = []) {
      ensureActive();
      const validation = verifyPlanShape(plan, scenario);
      if (validation.status !== "PASS") {
        const error = new Error(`Manual plan rejected: ${validation.reasons.join(", ")}`);
        error.code = validation.reasons[0] || "INVALID_MANUAL_PLAN";
        throw error;
      }
      state.verifiedPlan = clone(plan);
      state.recomputedMetrics = clone(verifiedMetrics(plan));
      state.activePlanHash = text(plan.planHash);
      state.identity = planIdentity(plan, scenario);
      state.manualLineage = clone(lineage);
      emit(EVENT_NAMES.manualPlan, { planHash: state.activePlanHash, manualRevision: state.identity.manualRevision });
      assertIdentity();
      return snapshot();
    }

    function setEnvironment(environment = {}) {
      ensureActive();
      state.reducedMotion = Boolean(environment.reducedMotion);
      state.webglAvailable = environment.webglAvailable !== false;
      return snapshot();
    }

    function reset() {
      ensureActive();
      destroyOwner("session");
      const openCount = state.openCount;
      state = { ...initialState(options), openCount };
      return snapshot();
    }

    function destroy() {
      if (destroyed) return;
      [...cleanups.keys()].forEach(destroyOwner);
      internalListeners.clear();
      state = initialState(options);
      destroyed = true;
    }

    return {
      get state() { return state; },
      MODES,
      EVENT_NAMES,
      IDENTITY_FIELDS,
      open,
      close,
      selectPlan,
      setMode,
      reset,
      destroy,
      snapshot,
      on,
      off,
      emit,
      selectVehicle,
      selectOrder,
      setComparison,
      setReplayState,
      setTimelineState,
      setStoryState,
      addSimulationEvent,
      undoSimulationEvent,
      resetSimulation,
      updateManualPlan,
      setEnvironment,
      registerCleanup,
      destroyOwner,
      assertIdentity,
    };
  }

  return {
    MODES,
    EVENT_NAMES,
    IDENTITY_FIELDS,
    createExperience,
    verifiedMetrics,
    verifyPlanShape,
    planIdentity,
    identityEqual,
    canonicalSimulationEvents,
    simulationIdentity,
    stableStringify,
    sha256,
    utf8Compare,
  };
});
