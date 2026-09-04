(function (root, factory) {
  "use strict";
  const base = root?.STCTExperienceFactory || (typeof require === "function" ? require("./experience-v14.js") : null);
  const simulation = root?.STCTSimulationStoreFactory || (typeof require === "function" ? require("./simulation-store-v15.js") : null);
  const domainEvents = root?.STCTV15?.domainEvents || (typeof require === "function" ? require("./domain-events-v15.js") : null);
  const api = factory(base, simulation, domainEvents);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.experience = api;
    root.STCTExperienceV15Factory = api;
    root.STCTExperience = api.createExperience({ eventTarget: typeof root.dispatchEvent === "function" ? root : null });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Base, Simulation, DomainEvents) {
  "use strict";

  if (!Base || !Simulation || !DomainEvents) throw new Error("STCT Experience v1.5 requires the v1.4 identity factory, SimulationStore v1.5, and Domain Events v1.5.");

  const VERSION = "stct-experience-v1.5";

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function createExperience(options = {}) {
    const core = Base.createExperience(options);
    const ownsEventStore = !options.eventStore;
    const eventStore = options.eventStore || DomainEvents.createEventStore({ clock: options.eventClock });
    const simulationStore = options.simulationStore || Simulation.createSimulationStore({ hash: options.simulationHash });
    const cleanupRegistry = new Map();
    const savedPlanSimulation = new Map();
    let destroyed = false;
    let lastCleanupReport = null;

    function eventContext(overrides = {}) {
      const base = core.snapshot();
      const simulation = simulationStore.snapshot();
      return {
        aggregateType: "EXPERIENCE",
        aggregateId: text(overrides.aggregateId || simulation.activePlanHash || base.activePlanHash || base.scenarioId || "STCT-EXPERIENCE"),
        scenarioId: text(overrides.scenarioId || base.scenarioId),
        inputHash: text(overrides.inputHash || base.inputHash),
        basePlanHash: text(overrides.basePlanHash || base.activePlanHash || simulation.activePlanHash),
        resultingPlanHash: text(overrides.resultingPlanHash),
        simulationHash: text(overrides.simulationHash || simulation.simulationHash),
        incidentHash: text(overrides.incidentHash),
        correlationId: text(overrides.correlationId),
        causationId: text(overrides.causationId),
        source: text(overrides.source || "experience-v15"),
        logicalTime: overrides.logicalTime,
        payload: clone(overrides.payload || {}),
      };
    }

    function appendDomainEvent(type, fields = {}, appendOptions = {}) {
      return eventStore.append(type, eventContext(fields), appendOptions);
    }

    const unsubscribeSimulationEvents = simulationStore.subscribe((detail) => {
      if (detail.type !== "COMMITTED" || !detail.operation) return;
      const operation = detail.operation;
      let type = "SIMULATION_RESET";
      if (operation.undoOfOperationId || operation.action === "REMOVE") type = "SIMULATION_EVENT_UNDONE";
      else if (operation.action === "ADD") type = "SIMULATION_EVENT_ADDED";
      appendDomainEvent(type, {
        aggregateType: "SIMULATION",
        aggregateId: detail.state.simulationHash,
        basePlanHash: detail.state.activePlanHash,
        resultingPlanHash: detail.state.activePlanHash,
        simulationHash: detail.state.simulationHash,
        source: operation.source,
        logicalTime: operation.occurredAtLogical,
        payload: { operation, report: detail.report, activeEventCount: detail.state.activeEvents.length },
      }, { dedupeKey: operation.operationId });
    });

    function ensureActive() {
      if (destroyed) {
        const error = new Error("Experience v1.5 controller has been destroyed.");
        error.code = "EXPERIENCE_DESTROYED";
        throw error;
      }
    }

    function mergedState() {
      const base = core.snapshot();
      const simulation = simulationStore.snapshot();
      return {
        ...base,
        version: VERSION,
        activePlanHash: simulation.activePlanHash || base.activePlanHash,
        simulationEvents: clone(simulation.activeEvents),
        activeEvents: clone(simulation.activeEvents),
        simulationHash: simulation.simulationHash,
        simulationRevision: simulation.simulationRevision,
        simulationOperationLog: clone(simulation.operationLog),
        rejectedSimulationEvents: clone(simulation.rejectedEvents),
        simulationStatus: simulation.status,
        lastSimulationMutation: clone(simulation.lastMutation),
        lastCleanupReport: clone(lastCleanupReport),
        domainEventCount: eventStore.state.eventCount,
        domainEventStreamHash: eventStore.state.eventStreamHash,
      };
    }

    function snapshot() {
      return clone(mergedState());
    }

    function registerCleanup(owner, cleanup) {
      ensureActive();
      if (typeof cleanup !== "function") throw new Error("Cleanup must be a function.");
      const key = text(owner || "session");
      if (!cleanupRegistry.has(key)) cleanupRegistry.set(key, new Set());
      cleanupRegistry.get(key).add(cleanup);
      return () => cleanupRegistry.get(key)?.delete(cleanup);
    }

    function destroyOwner(owner, options = {}) {
      const key = text(owner || "session");
      const owned = cleanupRegistry.get(key);
      const report = { owner: key, total: owned?.size || 0, successCount: 0, failureCount: 0, errors: [] };
      if (owned) {
        [...owned].reverse().forEach((cleanup, reverseIndex) => {
          try {
            cleanup();
            report.successCount += 1;
          } catch (error) {
            report.failureCount += 1;
            report.errors.push({
              reverseIndex,
              name: text(error?.name || "Error"),
              message: text(error?.message || error),
              code: text(error?.code),
            });
          }
        });
        owned.clear();
        cleanupRegistry.delete(key);
      }
      lastCleanupReport = clone(report);
      if (options.throwOnError && report.failureCount) {
        const aggregate = new AggregateError(report.errors.map((row) => Object.assign(new Error(row.message), { code: row.code })), `Cleanup owner ${key} failed ${report.failureCount} time(s).`);
        aggregate.code = "CLEANUP_AGGREGATE_ERROR";
        aggregate.report = clone(report);
        throw aggregate;
      }
      return report;
    }

    function saveCurrentSimulation() {
      const current = simulationStore.exportState();
      if (current.activePlanHash) savedPlanSimulation.set(current.activePlanHash, current);
      return current;
    }

    function verifyPlan(plan, scenario, prefix) {
      const validation = Base.verifyPlanShape(plan, scenario);
      if (validation.status !== "PASS") {
        const error = new Error(`${prefix}: ${validation.reasons.join(", ")}`);
        error.code = validation.reasons[0] || "INVALID_PLAN";
        error.reasons = validation.reasons;
        throw error;
      }
    }

    async function open(payload = {}) {
      ensureActive();
      verifyPlan(payload.plan, payload.scenario, "Experience requires a verified plan");
      if (core.state.opened) close({ reason: "reopen" });
      await core.open({ ...payload, simulationEvents: [] });
      await simulationStore.initialize(payload.plan, payload.simulationEvents || []);
      savedPlanSimulation.clear();
      const opened = appendDomainEvent("SCENARIO_OPENED", {
        aggregateType: "SCENARIO",
        aggregateId: payload.scenario.scenarioId || payload.scenario.inputHash,
        scenarioId: payload.scenario.scenarioId,
        inputHash: payload.scenario.inputHash,
        basePlanHash: payload.plan.planHash,
        resultingPlanHash: payload.plan.planHash,
        source: "experience-open",
        payload: { planId: payload.plan.planId, verificationStatus: payload.plan.verification?.status },
      });
      appendDomainEvent("PLAN_SELECTED", {
        aggregateType: "PLAN",
        aggregateId: payload.plan.planHash,
        scenarioId: payload.scenario.scenarioId,
        inputHash: payload.scenario.inputHash,
        basePlanHash: payload.plan.planHash,
        resultingPlanHash: payload.plan.planHash,
        causationId: opened.eventId,
        source: "experience-open",
        payload: { planId: payload.plan.planId, policy: "INITIAL" },
      });
      return snapshot();
    }

    function close(detail = {}) {
      ensureActive();
      if (!core.state.opened) return snapshot();
      destroyOwner("mode");
      destroyOwner("session");
      core.close(detail);
      return snapshot();
    }

    async function selectPlan(plan, scenario, options = {}) {
      ensureActive();
      verifyPlan(plan, scenario, "Plan selection rejected");
      saveCurrentSimulation();
      const policy = typeof options === "string" ? options : options.policy || "RESET";
      const transition = await simulationStore.setActivePlan(plan, policy, { source: options.source || "candidate-selection" });
      await core.selectPlan(plan, scenario);
      appendDomainEvent("PLAN_SELECTED", {
        aggregateType: "PLAN",
        aggregateId: plan.planHash,
        scenarioId: scenario.scenarioId,
        inputHash: scenario.inputHash,
        basePlanHash: transition.report?.sourcePlanHash,
        resultingPlanHash: plan.planHash,
        source: options.source || "candidate-selection",
        payload: { planId: plan.planId, policy, simulationTransition: transition.report || null },
      }, { dedupeKey: options.operationId });
      return { ...snapshot(), simulationTransition: clone(transition.report || null) };
    }

    async function updateManualPlan(plan, scenario, lineage = [], options = {}) {
      ensureActive();
      const proposal = appendDomainEvent("MANUAL_OPERATION_PROPOSED", {
        aggregateType: "PLAN",
        aggregateId: text(plan?.planHash || core.state.activePlanHash || "MANUAL-PROPOSAL"),
        resultingPlanHash: text(plan?.planHash),
        source: options.source || "manual-plan",
        payload: { lineage: clone(lineage), restoreSaved: Boolean(options.restoreSaved) },
      }, { dedupeKey: options.operationId ? `${options.operationId}:proposed` : "" });
      try {
        verifyPlan(plan, scenario, "Manual plan rejected");
        saveCurrentSimulation();
        let transition;
        const saved = savedPlanSimulation.get(text(plan.planHash));
        if (options.restoreSaved && saved) {
          transition = await simulationStore.restoreState(saved, { source: options.source || "manual-undo-restore" });
        } else {
          transition = await simulationStore.setActivePlan(plan, options.policy || "RESET", { source: options.source || "manual-plan" });
        }
        core.updateManualPlan(plan, scenario, lineage);
        appendDomainEvent(options.restoreSaved ? "MANUAL_UNDO" : "MANUAL_OPERATION_COMMITTED", {
          aggregateType: "PLAN",
          aggregateId: plan.planHash,
          scenarioId: scenario.scenarioId,
          inputHash: scenario.inputHash,
          resultingPlanHash: plan.planHash,
          causationId: proposal.eventId,
          source: options.source || "manual-plan",
          payload: { lineage: clone(lineage), simulationTransition: transition.report || null },
        }, { dedupeKey: options.operationId ? `${options.operationId}:committed` : "" });
        return { ...snapshot(), simulationTransition: clone(transition.report || null) };
      } catch (error) {
        appendDomainEvent("MANUAL_OPERATION_REJECTED", {
          aggregateType: "PLAN",
          aggregateId: text(plan?.planHash || proposal.aggregateId),
          causationId: proposal.eventId,
          source: options.source || "manual-plan",
          payload: { errorCode: text(error.code || "MANUAL_OPERATION_REJECTED"), errorMessage: text(error.message), lineage: clone(lineage) },
        }, { dedupeKey: options.operationId ? `${options.operationId}:rejected` : "" });
        throw error;
      }
    }

    async function addSimulationEvent(event, metadata = {}) {
      ensureActive();
      const result = await simulationStore.addEvent(event, metadata);
      core.emit(Base.EVENT_NAMES.simulation, { action: "ADD", operation: result.operation, simulationHash: result.snapshot.simulationHash });
      return snapshot();
    }

    async function removeSimulationEvent(eventId, metadata = {}) {
      ensureActive();
      const result = await simulationStore.removeEvent(eventId, metadata);
      core.emit(Base.EVENT_NAMES.simulation, { action: "REMOVE", operation: result.operation, simulationHash: result.snapshot.simulationHash });
      return snapshot();
    }

    async function undoSimulationEvent(metadata = {}) {
      ensureActive();
      const result = await simulationStore.undo(metadata);
      core.emit(Base.EVENT_NAMES.simulation, { action: "UNDO", operation: result.operation || null, simulationHash: result.snapshot.simulationHash });
      return snapshot();
    }

    async function redoSimulationEvent(metadata = {}) {
      ensureActive();
      const result = await simulationStore.redo(metadata);
      core.emit(Base.EVENT_NAMES.simulation, { action: "REDO", operation: result.operation || null, simulationHash: result.snapshot.simulationHash });
      return snapshot();
    }

    async function resetSimulation(metadata = {}) {
      ensureActive();
      const result = await simulationStore.reset(metadata);
      core.emit(Base.EVENT_NAMES.simulation, { action: "RESET", operation: result.operation, simulationHash: result.snapshot.simulationHash });
      return snapshot();
    }

    async function reset() {
      ensureActive();
      destroyOwner("mode");
      destroyOwner("session");
      const plan = core.state.verifiedPlan;
      const result = core.reset();
      if (plan?.planHash) await simulationStore.initialize(plan, []);
      return { ...result, ...snapshot() };
    }

    function destroy() {
      if (destroyed) return;
      [...cleanupRegistry.keys()].forEach((owner) => destroyOwner(owner));
      unsubscribeSimulationEvents();
      simulationStore.destroy();
      core.destroy();
      if (ownsEventStore) eventStore.destroy();
      savedPlanSimulation.clear();
      destroyed = true;
    }

    return {
      get state() { return mergedState(); },
      get simulationStore() { return simulationStore; },
      get eventStore() { return eventStore; },
      VERSION,
      MODES: Base.MODES,
      EVENT_NAMES: Base.EVENT_NAMES,
      IDENTITY_FIELDS: Base.IDENTITY_FIELDS,
      open,
      close,
      selectPlan,
      updateManualPlan,
      addSimulationEvent,
      removeSimulationEvent,
      undoSimulationEvent,
      redoSimulationEvent,
      resetSimulation,
      reset,
      destroy,
      snapshot,
      registerCleanup,
      destroyOwner,
      appendDomainEvent,
      assertIdentity: core.assertIdentity,
      on: core.on,
      off: core.off,
      emit: core.emit,
      setMode: core.setMode,
      selectVehicle: core.selectVehicle,
      selectOrder: core.selectOrder,
      setComparison: core.setComparison,
      setReplayState: core.setReplayState,
      setTimelineState: core.setTimelineState,
      setStoryState: core.setStoryState,
      setEnvironment: core.setEnvironment,
    };
  }

  return {
    ...Base,
    VERSION,
    createExperience,
  };
});
