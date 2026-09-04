(function (root, factory) {
  "use strict";
  const experience = root?.STCTExperienceFactory || (typeof require === "function" ? require("./experience-v14.js") : null);
  const api = factory(experience);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.simulation = api;
    root.STCTSimulationStoreFactory = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Experience) {
  "use strict";

  const VERSION = "stct-simulation-v1.5";
  const EVENT_TYPES = Object.freeze(["DELAY", "STOP_CLOSED", "ROAD_CLOSURE_SIMULATION", "VEHICLE_DELAY"]);
  const PLAN_POLICIES = Object.freeze(["RESET", "REBASE_COMPATIBLE", "REJECT_IF_ACTIVE"]);
  const OPERATION_ACTIONS = Object.freeze(["ADD", "REMOVE", "RESET", "REBASE"]);

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
    return Experience?.utf8Compare ? Experience.utf8Compare(left, right) : text(left).localeCompare(text(right));
  }

  function stableStringify(value) {
    if (Experience?.stableStringify) return Experience.stableStringify(value);
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    return `{${Object.keys(value).sort(compare).map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  async function sha256(value) {
    if (Experience?.sha256) return Experience.sha256(value);
    if (!globalThis.crypto?.subtle) throw new Error("SHA-256 is unavailable.");
    const bytes = new TextEncoder().encode(String(value));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }

  function fnv1a(value) {
    let hash = 0x811c9dc5;
    const source = new TextEncoder().encode(String(value));
    source.forEach((byte) => {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    });
    return hash.toString(16).padStart(8, "0");
  }

  function normalizeEvent(event = {}) {
    const type = text(event.type || "DELAY").toUpperCase();
    if (!EVENT_TYPES.includes(type)) {
      const error = new Error(`Unsupported simulation event type: ${type || "(empty)"}`);
      error.code = "UNSUPPORTED_SIMULATION_EVENT";
      throw error;
    }
    const normalized = {
      eventId: text(event.eventId),
      type,
      routeId: text(event.routeId),
      orderId: text(event.orderId),
      vehicleId: text(event.vehicleId),
      stopIndex: Math.max(0, Math.round(number(event.stopIndex))),
      minutes: Math.max(0, Math.round(number(event.minutes))),
      source: text(event.source || "user-simulation"),
      payload: clone(event.payload || {}),
    };
    if (!normalized.eventId) {
      normalized.eventId = `SIMEVT-${fnv1a(stableStringify({ ...normalized, eventId: undefined }))}`;
    }
    if (["DELAY", "STOP_CLOSED"].includes(type) && (!normalized.routeId || !normalized.orderId)) {
      const error = new Error(`${type} requires routeId and orderId.`);
      error.code = "INVALID_SIMULATION_EVENT_TARGET";
      throw error;
    }
    if (["DELAY", "VEHICLE_DELAY"].includes(type) && normalized.minutes <= 0) {
      const error = new Error(`${type} requires positive minutes.`);
      error.code = "INVALID_SIMULATION_EVENT_MINUTES";
      throw error;
    }
    if (type === "VEHICLE_DELAY" && !normalized.vehicleId) {
      const error = new Error("VEHICLE_DELAY requires vehicleId.");
      error.code = "INVALID_SIMULATION_EVENT_TARGET";
      throw error;
    }
    if (type === "ROAD_CLOSURE_SIMULATION" && !normalized.routeId) {
      const error = new Error("ROAD_CLOSURE_SIMULATION requires routeId.");
      error.code = "INVALID_SIMULATION_EVENT_TARGET";
      throw error;
    }
    return normalized;
  }

  function canonicalActiveEvents(events = []) {
    return events.map(normalizeEvent).sort((left, right) => (
      compare(left.type, right.type)
      || compare(left.routeId, right.routeId)
      || compare(left.vehicleId, right.vehicleId)
      || left.stopIndex - right.stopIndex
      || compare(left.orderId, right.orderId)
      || left.minutes - right.minutes
      || compare(left.eventId, right.eventId)
    ));
  }

  async function simulationIdentity(activePlanHash, events, hash = sha256) {
    return hash(stableStringify({
      version: VERSION,
      activePlanHash: text(activePlanHash),
      activeEvents: canonicalActiveEvents(events),
    }));
  }

  function planDescriptor(plan) {
    if (typeof plan === "string") return { planHash: text(plan), routes: [] };
    const routes = (plan?.routes || []).map((route) => ({
      routeId: text(route.routeId),
      vehicleId: text(route.vehicleId),
      orderIds: (route.orderIds || []).map(text),
    })).sort((left, right) => compare(left.routeId, right.routeId));
    return { planHash: text(plan?.planHash), routes };
  }

  function eventCompatibility(event, descriptor) {
    if (!EVENT_TYPES.includes(event.type)) return { compatible: false, reasonCode: "EVENT_TYPE_UNSUPPORTED" };
    const route = descriptor.routes.find((candidate) => candidate.routeId === event.routeId);
    if (!route) return { compatible: false, reasonCode: "ROUTE_NOT_FOUND" };
    if (event.type === "VEHICLE_DELAY" && route.vehicleId !== event.vehicleId) return { compatible: false, reasonCode: "VEHICLE_ROUTE_MISMATCH" };
    if (event.orderId) {
      const stopIndex = route.orderIds.indexOf(event.orderId);
      if (stopIndex < 0) return { compatible: false, reasonCode: "ORDER_NOT_IN_ROUTE" };
      return { compatible: true, event: { ...event, stopIndex }, reasonCode: stopIndex === event.stopIndex ? "COMPATIBLE" : "STOP_INDEX_REBASED" };
    }
    return { compatible: true, event: clone(event), reasonCode: "COMPATIBLE" };
  }

  function initialState() {
    return {
      version: VERSION,
      activePlanHash: "",
      simulationRevision: 0,
      nextOperationSequence: 1,
      activeEvents: [],
      operationLog: [],
      rejectedEvents: [],
      simulationHash: "",
      status: "IDLE",
      lastMutation: null,
    };
  }

  function createSimulationStore(options = {}) {
    const hash = options.hash || sha256;
    let state = initialState();
    let descriptor = planDescriptor(options.plan || options.activePlanHash || "");
    let queue = Promise.resolve();
    let destroyed = false;
    let lifecycle = 0;
    let nextRequestedRevision = 1;
    const listeners = new Set();
    const undoStack = [];
    const redoStack = [];

    function ensureActive() {
      if (destroyed) {
        const error = new Error("SimulationStore has been destroyed.");
        error.code = "SIMULATION_STORE_DESTROYED";
        throw error;
      }
    }

    function snapshot() {
      return clone(state);
    }

    function exportState() {
      return { ...snapshot(), planDescriptor: clone(descriptor) };
    }

    function capture() {
      return {
        activePlanHash: state.activePlanHash,
        activeEvents: clone(state.activeEvents),
        rejectedEvents: clone(state.rejectedEvents),
        simulationHash: state.simulationHash,
        descriptor: clone(descriptor),
      };
    }

    function emit(detail) {
      const payload = { ...clone(detail), state: snapshot() };
      listeners.forEach((listener) => listener(payload));
      return payload;
    }

    function subscribe(listener) {
      ensureActive();
      if (typeof listener !== "function") throw new Error("SimulationStore listener must be a function.");
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    function operationAction(action) {
      if (!OPERATION_ACTIONS.includes(action)) throw new Error(`Unsupported simulation operation action: ${action}`);
      return action;
    }

    function enqueue(specification) {
      ensureActive();
      const requestedRevision = nextRequestedRevision;
      nextRequestedRevision += 1;
      const requestedLifecycle = lifecycle;
      const run = async () => {
        ensureActive();
        const before = capture();
        state.status = "MUTATING";
        let outcome;
        try {
          outcome = await specification.mutate(clone(before));
        } catch (error) {
          state.status = "READY";
          throw error;
        }
        if (outcome?.noOperation) {
          state.status = "READY";
          return { status: "NO_OPERATION", requestedRevision, committedRevision: state.simulationRevision, operationId: "", snapshot: snapshot() };
        }
        const target = outcome?.target || before;
        const nextPlanHash = text(target.activePlanHash);
        const nextEvents = canonicalActiveEvents(target.activeEvents || []);
        const nextHash = await simulationIdentity(nextPlanHash, nextEvents, hash);
        if (destroyed || lifecycle !== requestedLifecycle) {
          return { status: "STALE_RESULT", requestedRevision, committedRevision: state.simulationRevision, operationId: "", snapshot: snapshot() };
        }
        const operationSequence = state.nextOperationSequence;
        const operationId = `SIMOP-${String(operationSequence).padStart(6, "0")}`;
        const committedRevision = state.simulationRevision + 1;
        const operation = {
          operationId,
          operationSequence,
          action: operationAction(outcome?.action || specification.action),
          eventId: text(specification.eventId || outcome?.eventId),
          beforeSimulationHash: before.simulationHash,
          afterSimulationHash: nextHash,
          occurredAtLogical: text(specification.occurredAtLogical || `REV-${String(committedRevision).padStart(6, "0")}`),
          source: text(specification.source || "simulation-store"),
          requestedRevision,
          committedRevision,
          undoOfOperationId: text(specification.undoOfOperationId || outcome?.undoOfOperationId),
          redoOfOperationId: text(specification.redoOfOperationId || outcome?.redoOfOperationId),
          reasonCodes: clone(outcome?.reasonCodes || []),
        };
        descriptor = clone(target.descriptor || descriptor);
        state = {
          ...state,
          activePlanHash: nextPlanHash,
          activeEvents: nextEvents,
          rejectedEvents: clone(target.rejectedEvents || []),
          simulationHash: nextHash,
          simulationRevision: committedRevision,
          nextOperationSequence: operationSequence + 1,
          operationLog: [...state.operationLog, operation],
          status: "READY",
          lastMutation: clone(operation),
        };
        const after = capture();
        if (specification.history === "UNDO") {
          const entry = undoStack.pop();
          if (entry) redoStack.push(entry);
        } else if (specification.history === "REDO") {
          const entry = redoStack.pop();
          if (entry) undoStack.push(entry);
        } else if (specification.reversible !== false) {
          undoStack.push({ before, after, operationId, action: specification.action, eventId: operation.eventId });
          redoStack.splice(0);
        }
        emit({ type: "COMMITTED", operation, report: clone(outcome?.report || null) });
        return { status: "COMMITTED", requestedRevision, committedRevision, operationId, operation: clone(operation), report: clone(outcome?.report || null), snapshot: snapshot() };
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    }

    function initialize(plan, events = []) {
      ensureActive();
      const requestedLifecycle = lifecycle;
      const nextDescriptor = planDescriptor(plan);
      if (!nextDescriptor.planHash) throw new Error("SimulationStore initialize requires planHash.");
      const run = async () => {
        const activeEvents = canonicalActiveEvents(events);
        const simulationHash = await simulationIdentity(nextDescriptor.planHash, activeEvents, hash);
        if (destroyed || lifecycle !== requestedLifecycle) return { status: "STALE_RESULT", snapshot: snapshot() };
        descriptor = nextDescriptor;
        state = {
          ...initialState(),
          activePlanHash: nextDescriptor.planHash,
          activeEvents,
          simulationHash,
          status: "READY",
        };
        nextRequestedRevision = 1;
        undoStack.splice(0);
        redoStack.splice(0);
        emit({ type: "INITIALIZED" });
        return { status: "INITIALIZED", snapshot: snapshot() };
      };
      const result = queue.then(run, run);
      queue = result.catch(() => undefined);
      return result;
    }

    function addEvent(event, metadata = {}) {
      const normalized = normalizeEvent(event);
      return enqueue({
        action: "ADD",
        eventId: normalized.eventId,
        source: metadata.source || normalized.source,
        occurredAtLogical: metadata.occurredAtLogical,
        mutate(before) {
          if (before.activeEvents.some((candidate) => candidate.eventId === normalized.eventId)) {
            const error = new Error(`Duplicate simulation eventId: ${normalized.eventId}`);
            error.code = "DUPLICATE_SIMULATION_EVENT";
            throw error;
          }
          const compatibility = eventCompatibility(normalized, descriptor);
          if (descriptor.routes.length && !compatibility.compatible) {
            const error = new Error(`Simulation event is incompatible with active plan: ${compatibility.reasonCode}`);
            error.code = compatibility.reasonCode;
            throw error;
          }
          return { target: { ...before, activeEvents: [...before.activeEvents, compatibility.event || normalized] } };
        },
      });
    }

    function removeEvent(eventId, metadata = {}) {
      const targetId = text(eventId);
      return enqueue({
        action: "REMOVE",
        eventId: targetId,
        source: metadata.source,
        occurredAtLogical: metadata.occurredAtLogical,
        mutate(before) {
          if (!before.activeEvents.some((event) => event.eventId === targetId)) return { noOperation: true };
          return { target: { ...before, activeEvents: before.activeEvents.filter((event) => event.eventId !== targetId) } };
        },
      });
    }

    function reset(metadata = {}) {
      return enqueue({
        action: "RESET",
        source: metadata.source,
        occurredAtLogical: metadata.occurredAtLogical,
        mutate: (before) => ({ target: { ...before, activeEvents: [], rejectedEvents: [] } }),
      });
    }

    function undo(metadata = {}) {
      return enqueue({
        action: "REMOVE",
        source: metadata.source || "undo",
        occurredAtLogical: metadata.occurredAtLogical,
        history: "UNDO",
        reversible: false,
        mutate() {
          const entry = undoStack.at(-1);
          if (!entry) return { noOperation: true };
          return {
            target: clone(entry.before),
            action: entry.action === "ADD" ? "REMOVE" : entry.action === "REMOVE" ? "ADD" : entry.action,
            eventId: entry.eventId,
            undoOfOperationId: entry.operationId,
          };
        },
      });
    }

    function redo(metadata = {}) {
      return enqueue({
        action: "ADD",
        source: metadata.source || "redo",
        occurredAtLogical: metadata.occurredAtLogical,
        history: "REDO",
        reversible: false,
        mutate() {
          const entry = redoStack.at(-1);
          if (!entry) return { noOperation: true };
          return { target: clone(entry.after), action: entry.action, eventId: entry.eventId, redoOfOperationId: entry.operationId };
        },
      });
    }

    function setActivePlan(plan, policy = "RESET", metadata = {}) {
      const targetDescriptor = planDescriptor(plan);
      const selectedPolicy = text(policy || "RESET").toUpperCase();
      if (!targetDescriptor.planHash) throw new Error("setActivePlan requires planHash.");
      if (!PLAN_POLICIES.includes(selectedPolicy)) throw new Error(`Unsupported plan change policy: ${selectedPolicy}`);
      return enqueue({
        action: selectedPolicy === "REBASE_COMPATIBLE" ? "REBASE" : "RESET",
        source: metadata.source || "plan-change",
        occurredAtLogical: metadata.occurredAtLogical,
        mutate(before) {
          if (selectedPolicy === "REJECT_IF_ACTIVE" && before.activeEvents.length) {
            const error = new Error("Active simulation events block plan change.");
            error.code = "ACTIVE_SIMULATION_REJECTS_PLAN_CHANGE";
            throw error;
          }
          const retained = [];
          const rejected = [];
          const reasonCodes = [];
          if (selectedPolicy === "REBASE_COMPATIBLE") {
            before.activeEvents.forEach((event) => {
              const compatibility = eventCompatibility(event, targetDescriptor);
              reasonCodes.push(compatibility.reasonCode);
              if (compatibility.compatible) retained.push(compatibility.event);
              else rejected.push({ event: clone(event), reasonCode: compatibility.reasonCode, sourcePlanHash: before.activePlanHash, targetPlanHash: targetDescriptor.planHash });
            });
          }
          const activeEvents = selectedPolicy === "REBASE_COMPATIBLE" ? retained : [];
          const report = {
            sourcePlanHash: before.activePlanHash,
            targetPlanHash: targetDescriptor.planHash,
            retainedEventIds: retained.map((event) => event.eventId),
            rejectedEvents: clone(rejected),
            reasonCodes: [...new Set(reasonCodes)],
            beforeHash: before.simulationHash,
            afterHash: "",
            policy: selectedPolicy,
          };
          return {
            target: { ...before, activePlanHash: targetDescriptor.planHash, activeEvents, rejectedEvents: rejected, descriptor: targetDescriptor },
            reasonCodes: report.reasonCodes,
            report,
          };
        },
      }).then((result) => {
        if (result.report) result.report.afterHash = result.snapshot.simulationHash;
        return result;
      });
    }

    function restoreState(savedState, metadata = {}) {
      const saved = clone(savedState || {});
      const savedDescriptor = saved.planDescriptor || { planHash: saved.activePlanHash, routes: [] };
      return enqueue({
        action: "REBASE",
        source: metadata.source || "restore-saved-state",
        occurredAtLogical: metadata.occurredAtLogical,
        mutate: (before) => ({
          target: {
            ...before,
            activePlanHash: text(saved.activePlanHash),
            activeEvents: clone(saved.activeEvents || []),
            rejectedEvents: clone(saved.rejectedEvents || []),
            descriptor: clone(savedDescriptor),
          },
          reasonCodes: ["RESTORED_SAVED_SIMULATION_STATE"],
        }),
      });
    }

    function whenIdle() {
      return queue.then(() => snapshot());
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      lifecycle += 1;
      state.status = "DESTROYED";
      listeners.clear();
    }

    if (descriptor.planHash) {
      state.activePlanHash = descriptor.planHash;
      state.status = "UNINITIALIZED_HASH";
    }

    return {
      get state() { return snapshot(); },
      VERSION,
      EVENT_TYPES,
      PLAN_POLICIES,
      initialize,
      addEvent,
      removeEvent,
      undo,
      redo,
      reset,
      rebase: (plan, metadata) => setActivePlan(plan, "REBASE_COMPATIBLE", metadata),
      setActivePlan,
      restoreState,
      snapshot,
      exportState,
      subscribe,
      whenIdle,
      destroy,
    };
  }

  return {
    VERSION,
    EVENT_TYPES,
    PLAN_POLICIES,
    OPERATION_ACTIONS,
    createSimulationStore,
    normalizeEvent,
    canonicalActiveEvents,
    simulationIdentity,
    planDescriptor,
    eventCompatibility,
    stableStringify,
    sha256,
  };
});
