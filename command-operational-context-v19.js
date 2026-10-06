(function (root, factory) {
  "use strict";
  const dependencies = typeof module === "object" && module.exports
    ? {
      Integrity: require("./integrity-hash-v151.js"),
      Workspace: require("./operations-workspace-v17.js"),
      FleetReplay: require("./fleet-replay-v17.js"),
      FleetTracks: require("./fleet-tracks-v17.js"),
      PlanActual: require("./multi-vehicle-plan-actual-v17.js"),
      Alerts: require("./operations-alerts-v16.js"),
      Recovery: require("./rolling-recovery-v16.js"),
      OfflineQueue: require("./offline-queue-v16.js"),
      Driver: require("./driver-simulator-v16.js"),
      DriverProjection: require("./driver-local-projection-v17.js"),
      ShiftReview: require("./shift-review-v17.js"),
      FlightRecorder: require("./flight-recorder-v17.js"),
      Reducer: require("./execution-reducer-v17.js"),
      Simulation: require("./simulation-store-v15.js"),
    }
    : {
      Integrity: root.STCTV15?.integrityHash,
      Workspace: root.STCTV17?.operationsWorkspace,
      FleetReplay: root.STCTV17?.fleetReplay,
      FleetTracks: root.STCTV17?.fleetTracks,
      PlanActual: root.STCTV17?.multiVehiclePlanActual,
      Alerts: root.STCTV16?.operationsAlerts,
      Recovery: root.STCTV16?.rollingRecovery,
      OfflineQueue: root.STCTV16?.offlineQueue,
      Driver: root.STCTV16?.driverSimulator,
      DriverProjection: root.STCTV17?.driverLocalProjection,
      ShiftReview: root.STCTV17?.shiftReview,
      FlightRecorder: root.STCTV17?.flightRecorder,
      Reducer: root.STCTV17?.executionReducer,
      Simulation: root.STCTV15?.simulation,
    };
  const api = factory(root, dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.STCTPlatformV19 = root.STCTPlatformV19 || {};
    root.STCTPlatformV19.commandOperationalContext = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, dependencies) {
  "use strict";

  const SCHEMA_VERSION = "stct-command-operational-context-v1.9-p3";
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value == null ? "" : value).trim();

  function planFromScenario(scenario) {
    const routes = scenario.routes.map((route) => ({
      ...clone(route),
      plannedDistanceMeters: dependencies.PlanActual.geometryDistance(route.geometry),
      totalDistance: dependencies.PlanActual.geometryDistance(route.geometry) / 1000,
      verification: { status: "PASS" },
    }));
    const value = {
      schemaVersion: "stct-command-applied-plan-v1.9-p3",
      planId: "P3-SYNTHETIC-VERIFIED",
      revision: 1,
      logicalStartMinute: 100,
      matrixHash: dependencies.Integrity.hashValue({ provider: "SYNTHETIC_ROAD_FIXTURE", scenarioHash: scenario.scenarioHash }),
      providerProvenance: { providerId: "SYNTHETIC_ROAD_FIXTURE", mode: "LOCAL_DETERMINISTIC", publicRequest: false },
      verification: { status: "PASS", checks: ["ROUTE_IDENTITY", "ORDER_COVERAGE", "GEOMETRY"] },
      routes,
      unassignedOrderIds: [],
    };
    value.planHash = dependencies.Integrity.hashValue({ planId: value.planId, revision: value.revision, routes: value.routes });
    return value;
  }

  function scenarioFromAppliedPlan(appliedPlan) {
    const sourceScenario = clone(appliedPlan?.meta?.scenarioSnapshot || appliedPlan?.scenario || {});
    const sourceOrders = new Map((sourceScenario.orders || []).map((order) => [text(order.id || order.orderId || order.code), order]));
    const routes = (appliedPlan?.routes || []).map((route, routeIndex) => {
      const routeId = text(route.routeId || `APPLIED-R${String(routeIndex + 1).padStart(2, "0")}`);
      const features = (appliedPlan.routeGeoJson?.features || []).filter((feature) => text(feature.properties?.routeId) === routeId);
      const geometry = clone(features.length === 1 ? features[0].geometry?.coordinates : route.geometry || route.routeGeometry || route.coordinates || []);
      if (features.length > 1 || (features.length === 1 && features[0].geometry?.type !== "LineString")
        || !Array.isArray(geometry) || geometry.length < 2
        || geometry.some((point) => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)) {
        throw Object.assign(new Error(`Applied route ${routeId} requires unambiguous real LineString geometry`), { code: "APPLIED_ROUTE_GEOMETRY_INVALID" });
      }
      return {
        ...clone(route),
        routeId,
        vehicleId: text(route.vehicleId || route.vehicle?.id || `APPLIED-V${String(routeIndex + 1).padStart(2, "0")}`),
        revision: Number(route.revision || appliedPlan.revision || 1),
        orderIds: clone(route.orderIds || route.orders?.map((order) => text(order.id || order.orderId || order.code)) || []),
        geometry,
      };
    });
    const stops = routes.flatMap((route) => route.orderIds.map((orderId, stopIndex) => {
      const order = sourceOrders.get(text(orderId)) || {};
      const coordinate = Number.isFinite(Number(order.lon)) && Number.isFinite(Number(order.lat))
        ? [Number(order.lon), Number(order.lat)]
        : route.geometry[Math.min(stopIndex + 1, route.geometry.length - 1)];
      return { ...clone(order), orderId: text(orderId), routeId: route.routeId, vehicleId: route.vehicleId, sequence: stopIndex + 1, coordinate, logicalTime: 100 + stopIndex * 20 };
    }));
    const positions = routes.flatMap((route) => route.geometry.map((coordinate, index) => ({
      vehicleId: route.vehicleId,
      routeId: route.routeId,
      routeRevision: route.revision,
      logicalTime: 100 + index * 10,
      matchedCoordinate: coordinate,
      matchedEdgeId: `APPLIED-${route.routeId}-${index}`,
      offRoute: false,
      matchConfidence: "PLAN_GEOMETRY",
      alertCount: 0,
      derivedTelemetryHash: dependencies.Integrity.hashValue({ planHash: appliedPlan.planHash, routeId: route.routeId, index, coordinate }),
      progress: route.geometry.length > 1 ? index / (route.geometry.length - 1) : 0,
    })));
    const events = positions.map((position, index) => ({ eventId: `APPLIED-POS-${String(index + 1).padStart(5, "0")}`, eventType: "POSITION_RECORDED", vehicleId: position.vehicleId, routeId: position.routeId, logicalTime: position.logicalTime, derivedTelemetryHash: position.derivedTelemetryHash }));
    const value = {
      schemaVersion: "stct-applied-plan-operational-scenario-v1.9-p31",
      dataClassification: text(sourceScenario.dataClassification || appliedPlan.dataClassification || "UPLOADED_BUSINESS_DATA"),
      liveFleetClaim: false,
      boundary: "VERIFIED_APPLIED_PLAN_LOCAL_OPERATIONAL_PROJECTION",
      sourceType: "UPLOADED_APPLIED",
      routes,
      stops,
      positions,
      events,
      alerts: [],
      sharedClock: { start: 100, end: Math.max(100, ...positions.map((row) => row.logicalTime)), unit: "LOGICAL_SECONDS" },
      scenarioHash: text(appliedPlan.inputHash || sourceScenario.inputHash),
    };
    if (!value.scenarioHash) value.scenarioHash = dependencies.Integrity.hashValue({ planHash: appliedPlan.planHash, routes, stops });
    return value;
  }

  function recoveryFixture(plan, executionRunHash, executionStateHash) {
    const incidentHash = dependencies.Integrity.hashValue({ source: "P3_SYNTHETIC_EXCEPTION", executionRunHash });
    const context = {
      contextHash: dependencies.Integrity.hashValue({ planHash: plan.planHash, executionStateHash }),
      cutoffLogicalMinute: 120,
      executionRunHash,
      executionStateHash,
      matrixHash: plan.matrixHash,
      transferPolicy: "PIN_COMPLETED_AND_ACTIVE",
    };
    const session = dependencies.Recovery.createSession({ basePlan: plan, context, incidentHash });
    const local = clone(plan);
    local.planId = "P3-LOCAL-RECOVERY";
    local.candidateType = "LOCAL_REPAIR";
    local.incidentHash = incidentHash;
    local.changePenalty = { total: 2, movedStops: 2 };
    local.integrationEvidence = { status: "LOCAL_DETERMINISTIC", acceptedAsIntegrationEvidence: false };
    local.verification = { status: "PASS", checks: ["CAPACITY", "ORDER_COVERAGE", "TIME_WINDOW"] };
    local.routes[0].orderIds = [...local.routes[0].orderIds.slice(1), local.routes[0].orderIds[0]];
    local.planHash = dependencies.Integrity.hashValue({ planId: local.planId, routes: local.routes, incidentHash });
    const reference = { ...clone(plan), candidateType: "CURRENT_PLAN_REFERENCE", reference: true, changePenalty: { total: 0 }, verification: { status: "PASS" } };
    const pool = { requestHash: dependencies.Integrity.hashValue({ incidentHash, contextHash: context.contextHash }), candidates: [reference, local] };
    return { incidentHash, context, session, local, pool };
  }

  function appendSeedEvent(store, run, input) {
    const state = store.snapshot();
    const event = dependencies.Reducer.createEvent(run, {
      eventId: `P3-SEED-${String(state.acceptedEvents.length + 1).padStart(4, "0")}`,
      sequence: state.acceptedEvents.length + 1,
      executionRevision: run.revision,
      logicalTime: Math.max(state.latestLogicalTime + 1, Number(input.logicalTime || 0)),
      source: "LOCAL_SYNTHETIC_P3_FIXTURE",
      payload: { planRevision: run.revision, routeRevision: run.revision, ...(input.payload || {}) },
      ...input,
    });
    const result = store.append(event);
    if (result.status !== "ACCEPTED") {
      const error = new Error(`P3 seed event rejected: ${result.code || result.status}`);
      error.code = result.code || "P3_SEED_EVENT_REJECTED";
      throw error;
    }
    return result;
  }

  function seedExecution(store, run, scenario) {
    appendSeedEvent(store, run, { eventType: "RUN_RELEASED", logicalTime: 101 });
    scenario.routes.slice(0, 2).forEach((route, index) => {
      appendSeedEvent(store, run, { eventType: "ROUTE_ACCEPTED", routeId: route.routeId, vehicleId: route.vehicleId, logicalTime: 102 + index * 5 });
      appendSeedEvent(store, run, { eventType: "VEHICLE_DEPARTED", routeId: route.routeId, vehicleId: route.vehicleId, logicalTime: 103 + index * 5 });
      const coordinate = route.geometry[Math.min(3, route.geometry.length - 1)];
      appendSeedEvent(store, run, {
        eventType: "POSITION_RECORDED",
        routeId: route.routeId,
        vehicleId: route.vehicleId,
        coordinate,
        roadEdgeId: `P3-EDGE-${route.routeId}`,
        logicalTime: 104 + index * 5,
        payload: { derivedTelemetryHash: dependencies.Integrity.hashValue({ routeId: route.routeId, point: coordinate }), telemetryStatus: "PASS" },
      });
      if (index === 0) {
        const orderId = route.orderIds[0];
        appendSeedEvent(store, run, { eventType: "STOP_ARRIVED", routeId: route.routeId, vehicleId: route.vehicleId, orderId, logicalTime: 105 });
        appendSeedEvent(store, run, { eventType: "SERVICE_STARTED", routeId: route.routeId, vehicleId: route.vehicleId, orderId, logicalTime: 106 });
        appendSeedEvent(store, run, { eventType: "SERVICE_COMPLETED", routeId: route.routeId, vehicleId: route.vehicleId, orderId, logicalTime: 107, ackId: "P3-SEED-ACK-1" });
      }
    });
  }

  function createContext(options = {}) {
    const locale = ["zh", "en", "ja"].includes(options.locale) ? options.locale : "zh";
    const noWebGL = options.noWebGL === true;
    const fixture = { vehicleCount: 8, stopsPerVehicle: 8, positionsPerVehicle: 18, ...(options.fixture || {}) };
    let scenario = options.appliedPlan ? scenarioFromAppliedPlan(options.appliedPlan) : dependencies.FleetReplay.syntheticScenario(fixture);
    let plan = options.appliedPlan ? clone(options.appliedPlan) : planFromScenario(scenario);
    let contextSource = options.appliedPlan ? "UPLOADED_APPLIED" : "SYNTHETIC_FALLBACK";
    let transitionEvents = [];
    let alertStore = dependencies.Alerts.createInbox();
    let workspace = dependencies.Workspace.createWorkspace({ appliedPlan: plan, alertStore, locale });
    workspace.createExecutionFromPlan(plan, { scenarioId: `SCENARIO-${scenario.scenarioHash.slice(-12)}`, inputHash: scenario.scenarioHash, noWebGL });
    let executionStore = workspace.executionStore();
    let run = executionStore.snapshot().run;
    if(plan.sourceGate!=="P5_DATA_DRAFT")seedExecution(executionStore, run, scenario);
    let replay = workspace.createFleetReplay(scenario);
    let simulationStore = dependencies.Simulation.createSimulationStore();
    let simulationReady = simulationStore.initialize(plan);
    let recovery = recoveryFixture(plan, run.executionRunHash, executionStore.snapshot().executionStateHash);
    workspace.attachRecoverySession(recovery.session);
    workspace.ingestRecoveryPool(recovery.pool);
    let offlineQueue = dependencies.OfflineQueue.createQueue();
    let driver = dependencies.Driver.create({ run, plan, store: executionStore, queue: offlineQueue, inbox: alertStore, vehicleId: scenario.routes[Math.min(2, scenario.routes.length - 1)].vehicleId });
    let incidents = [];
    let localReviewNotes = new Map();
    const subscribers = new Set();
    let selected = { routeId: scenario.routes[0].routeId, vehicleId: scenario.routes[0].vehicleId, orderId: "", stopId: "", alertId: "", incidentId: "" };
    let revision = 0;

    scenario.routes.forEach((route, index) => {
      if(plan.sourceGate==="P5_DATA_DRAFT")return;
      if (index > 4) return;
      const ruleId = index === 0 ? "TIME_WINDOW_MISSED" : index === 1 ? "OFF_ROUTE" : index === 2 ? "ROUTE_STALLED" : index === 3 ? "EXCESS_DWELL" : "ETA_RISK";
      alertStore.add(dependencies.Alerts.createAlert({
        alertId: `P3-ALERT-${String(index + 1).padStart(2, "0")}`,
        ruleId,
        executionRunHash: run.executionRunHash,
        routeId: route.routeId,
        vehicleId: route.vehicleId,
        orderId: route.orderIds[0],
        openedLogicalTime: 112 + index,
        severity: index === 0 ? "CRITICAL" : index < 3 ? "HIGH" : undefined,
        evidence: [{ source: "LOCAL_SYNTHETIC_P3_FIXTURE", metric: ruleId, actualValue: 12 + index }],
        deduplicationKey: `P3:${ruleId}:${route.routeId}`,
      }));
    });

    function notify(type, detail = {}) {
      revision += 1;
      const event = { type, detail: clone(detail), revision };
      subscribers.forEach((listener) => listener(snapshot(), event));
      return event;
    }

    function seedAlerts() {
      if(plan.sourceGate==="P5_DATA_DRAFT")return;
      scenario.routes.forEach((route, index) => {
        if (index > 4) return;
        const ruleId = index === 0 ? "TIME_WINDOW_MISSED" : index === 1 ? "OFF_ROUTE" : index === 2 ? "ROUTE_STALLED" : index === 3 ? "EXCESS_DWELL" : "ETA_RISK";
        alertStore.add(dependencies.Alerts.createAlert({
          alertId: `P3-ALERT-${String(index + 1).padStart(2, "0")}`,
          ruleId,
          executionRunHash: run.executionRunHash,
          routeId: route.routeId,
          vehicleId: route.vehicleId,
          orderId: route.orderIds[0],
          openedLogicalTime: 112 + index,
          severity: index === 0 ? "CRITICAL" : index < 3 ? "HIGH" : undefined,
          evidence: [{ source: contextSource === "SYNTHETIC_FALLBACK" ? "LOCAL_SYNTHETIC_P3_FIXTURE" : "APPLIED_PLAN_LOCAL_PROJECTION", metric: ruleId, actualValue: 12 + index }],
          deduplicationKey: `P3:${ruleId}:${route.routeId}`,
        }));
      });
    }

    function rebuildSession(nextScenario, nextPlan, sourceType) {
      // All new authorities are local to this synchronous rebuild. If preparation
      // fails, retain every prior session reference instead of a mixed context.
      const previous = { scenario, plan, contextSource, alertStore, workspace, executionStore, run, replay, simulationStore, simulationReady, recovery, offlineQueue, incidents, localReviewNotes, selected, driver };
      try {
        scenario = clone(nextScenario);
        plan = clone(nextPlan);
        contextSource = sourceType;
        alertStore = dependencies.Alerts.createInbox();
        workspace = dependencies.Workspace.createWorkspace({ appliedPlan: plan, alertStore, locale: workspace.snapshot().locale });
        workspace.createExecutionFromPlan(plan, { scenarioId: `SCENARIO-${scenario.scenarioHash.slice(-12)}`, inputHash: scenario.scenarioHash, noWebGL });
        executionStore = workspace.executionStore();
        run = executionStore.snapshot().run;
        if(plan.sourceGate!=="P5_DATA_DRAFT")seedExecution(executionStore, run, scenario);
        replay = workspace.createFleetReplay(scenario);
        simulationStore = dependencies.Simulation.createSimulationStore();
        simulationReady = simulationStore.initialize(plan);
        recovery = recoveryFixture(plan, run.executionRunHash, executionStore.snapshot().executionStateHash);
        workspace.attachRecoverySession(recovery.session);
        workspace.ingestRecoveryPool(recovery.pool);
        offlineQueue = dependencies.OfflineQueue.createQueue();
        incidents = [];
        localReviewNotes = new Map();
        selected = { routeId: scenario.routes[0]?.routeId || "", vehicleId: scenario.routes[0]?.vehicleId || "", orderId: "", stopId: "", alertId: "", incidentId: "" };
        driver = dependencies.Driver.create({ run, plan, store: executionStore, queue: offlineQueue, inbox: alertStore, vehicleId: scenario.routes[Math.min(2, scenario.routes.length - 1)].vehicleId });
        seedAlerts();
      } catch (error) {
        ({ scenario, plan, contextSource, alertStore, workspace, executionStore, run, replay, simulationStore, simulationReady, recovery, offlineQueue, incidents, localReviewNotes, selected, driver } = previous);
        throw error;
      }
    }

    function adoptAppliedPlan(appliedPlan, transition = {}) {
      if (!appliedPlan?.planHash || appliedPlan.verification?.status !== "PASS" || !Array.isArray(appliedPlan.routes) || !appliedPlan.routes.length) {
        return { status: "REJECTED", code: "VERIFIED_APPLIED_PLAN_REQUIRED" };
      }
      const policy = text(transition.policy || "REJECT_WHILE_RUNNING");
      if (!["REJECT_WHILE_RUNNING", "RESET_EXECUTION", "EXPLICIT_MIGRATION"].includes(policy)) return { status: "REJECTED", code: "PLAN_CHANGE_POLICY_INVALID", policy };
      const active = !["COMPLETED", "CANCELLED", "FAILED"].includes(executionStore.snapshot().run.status);
      if (active && policy === "REJECT_WHILE_RUNNING") return { status: "REJECTED", code: "ACTIVE_EXECUTION_PLAN_CHANGE_REJECTED", policy, activePlanHash: plan.planHash };
      if (active && policy === "EXPLICIT_MIGRATION" && transition.migrationApproved !== true) return { status: "REJECTED", code: "EXPLICIT_MIGRATION_APPROVAL_REQUIRED", policy, activePlanHash: plan.planHash };
      const before = { scenarioHash: scenario.scenarioHash, planHash: plan.planHash, executionRunHash: run.executionRunHash };
      const nextScenario = scenarioFromAppliedPlan(appliedPlan);
      rebuildSession(nextScenario, appliedPlan, "UPLOADED_APPLIED");
      const event = {
        schemaVersion: "stct-command-context-transition-v1.9-p31",
        transitionId: `COMMAND-CONTEXT-${String(transitionEvents.length + 1).padStart(4, "0")}`,
        policy,
        reason: text(transition.reason || "VERIFIED_PLAN_APPLIED"),
        before,
        after: { scenarioHash: scenario.scenarioHash, planHash: plan.planHash, executionRunHash: run.executionRunHash },
      };
      event.transitionHash = dependencies.Integrity.hashValue(event);
      transitionEvents.push(event);
      notify("VERIFIED_APPLIED_PLAN_ADOPTED", event);
      return { status: "ADOPTED", sourceType: contextSource, event: clone(event) };
    }

    function currentTracks() { return dependencies.FleetTracks.build(scenario.positions); }
    function planActual() { return dependencies.PlanActual.build({ plan: workspace.snapshot().appliedPlan || plan, executionState: executionStore.snapshot(), tracks: currentTracks(), alerts: alertStore.snapshot().alerts, now: replay.snapshot().clock }); }
    function flightRecorder() { return dependencies.FlightRecorder.build({ executionRunHash: run.executionRunHash, executionEvents: executionStore.snapshot().acceptedEvents, alertEvents: alertStore.snapshot().auditEvents, incidents, recoveries: recovery.session.exportLineage().actions, planRevisions: recovery.session.exportLineage().actions }); }
    function shiftReview() {
      const execution = executionStore.snapshot();
      const pva = planActual();
      return dependencies.ShiftReview.build({
        executionState: execution,
        events: execution.acceptedEvents,
        alerts: alertStore.snapshot(),
        planActual: pva,
        reconciliation: { connectionState: driver.viewModel().offline ? "OFFLINE" : "ONLINE", pending: offlineQueue.summary().total, unresolvedConflicts: offlineQueue.summary().counts.CONFLICT, ackAuditCount: offlineQueue.summary().ackAuditCount },
        incidents,
        recoveries: recovery.session.exportLineage().actions,
        planRevisions: recovery.session.exportLineage().actions,
        tracks: currentTracks(),
        locale: workspace.snapshot().locale,
      });
    }
    function select(patch, source = "COMMAND_CONTEXT") {
      const next = Object.fromEntries(Object.entries(patch || {}).filter(([, value]) => value !== undefined));
      const stopId = next.orderId || next.stopId;
      const stop = stopId ? scenario.stops.find((row) => row.orderId === stopId) : null;
      const route = stop
        ? scenario.routes.find((row) => row.routeId === stop.routeId)
        : next.vehicleId
          ? scenario.routes.find((row) => row.vehicleId === next.vehicleId)
          : next.routeId
            ? scenario.routes.find((row) => row.routeId === next.routeId)
            : null;
      if (stop) {
        next.orderId = stop.orderId;
        next.stopId = stop.orderId;
        next.routeId = stop.routeId;
        next.vehicleId = stop.vehicleId || route?.vehicleId || "";
      } else if (route) {
        next.routeId = route.routeId;
        next.vehicleId = route.vehicleId;
        next.orderId = "";
        next.stopId = "";
      }
      if ((next.routeId !== undefined || next.vehicleId !== undefined || next.orderId !== undefined) && next.alertId === undefined) next.alertId = "";
      if ((next.routeId !== undefined || next.vehicleId !== undefined || next.orderId !== undefined) && next.incidentId === undefined) next.incidentId = "";
      selected = { ...selected, ...next };
      workspace.focus({ routeId: selected.routeId, vehicleId: selected.vehicleId, orderId: selected.orderId, alertId: selected.alertId }, source === "ALERT" ? "ALERT" : "EVENT");
      replay.select({ routeId: selected.routeId, vehicleId: selected.vehicleId, stopId: selected.stopId || selected.orderId, alertId: selected.alertId });
      notify("CONTEXT_SELECTED", selected);
      return clone(selected);
    }
    function appendExecution(eventType, fields = {}) {
      const state = executionStore.snapshot();
      return appendSeedEvent(executionStore, state.run, {
        eventType,
        logicalTime: Math.max(state.latestLogicalTime + 1, Number(fields.logicalTime || 0)),
        routeId: fields.routeId,
        vehicleId: fields.vehicleId,
        orderId: fields.orderId,
        coordinate: fields.coordinate,
        roadEdgeId: fields.roadEdgeId,
        ackId: fields.ackId,
        source: fields.source || "LOCAL_DISPATCHER",
        payload: fields.payload || {},
      });
    }
    async function addSimulationDelay(routeId, orderId, minutes = 15) {
      await simulationReady;
      const result = await simulationStore.addEvent({ type: "DELAY", routeId, orderId, minutes, source: "COMMAND_MISSION_CONTROL" });
      notify("SIMULATION_DELAY_ADDED", { routeId, orderId, minutes, simulationHash: result.snapshot?.simulationHash || simulationStore.snapshot().simulationHash });
      return result;
    }
    function addIncidentFromAlert(alertId, detail = {}) {
      const existing = incidents.find((row) => row.sourceAlertHash === alertStore.list().find((alert) => alert.alertId === alertId)?.alertHash);
      if (existing) return clone(existing);
      const incident = workspace.alertToIncident(alertId, { logicalTime: executionStore.snapshot().latestLogicalTime + 1, reason: detail.reason || "Dispatcher recovery review" });
      incidents.push(incident);
      selected = { ...selected, alertId, incidentId: incident.incidentId, routeId: incident.routeId, vehicleId: incident.vehicleId, orderId: incident.orderId };
      notify("INCIDENT_CREATED", { incidentId: incident.incidentId, incidentHash: incident.incidentHash, alertId });
      return clone(incident);
    }
    function continueExecution() {
      const result = workspace.continueExecution({ noWebGL });
      executionStore = workspace.executionStore();
      run = executionStore.snapshot().run;
      appendSeedEvent(executionStore, run, { eventType: "RUN_RELEASED", logicalTime: executionStore.snapshot().latestLogicalTime + 1 });
      driver = dependencies.Driver.create({ run, plan: workspace.snapshot().appliedPlan, store: executionStore, queue: offlineQueue, inbox: alertStore, vehicleId: scenario.routes[2].vehicleId });
      notify("EXECUTION_CONTINUED_AFTER_RECOVERY", { executionRunHash: run.executionRunHash, planHash: run.planHash });
      return result;
    }
    function markReviewNote(actionItemId, note) {
      localReviewNotes.set(text(actionItemId), { source: "PRESENTATION_METADATA", note: text(note), revision: revision + 1 });
      notify("LOCAL_REVIEW_NOTE_UPDATED", { actionItemId });
      return clone(localReviewNotes.get(text(actionItemId)));
    }
    function setLocale(nextLocale) { workspace.setLocale(nextLocale); notify("LOCALE_CHANGED", { locale: nextLocale }); }
    function pauseForWorkspaceSwitch() {
      const before = replay.snapshot();
      replay.seek(before.clock);
      notify("WORKSPACE_SWITCH_PAUSED_UI_REPLAY", { cursor: before.clock, authoritativeRunStatus: executionStore.snapshot().run.status });
      return replay.snapshot();
    }
    function fullReoptimizationAvailability() {
      const engine = options.fullRecoveryEngine || { available: false, status: "UNAVAILABLE_DEPENDENCY" };
      return dependencies.Recovery.fullAvailability(plan.providerProvenance, engine);
    }
    async function runFullReoptimization() {
      const availability = fullReoptimizationAvailability();
      if (!availability.fullAvailable || typeof options.fullRecoveryEngine?.generateRecovery !== "function") return availability;
      const before = snapshot();
      const result = await options.fullRecoveryEngine.generateRecovery({ scenario: clone(scenario), plan: clone(before.plan), execution: clone(before.execution), incidents: clone(before.incidents), recoveryContext: clone(recovery.context) });
      notify("FULL_REOPTIMIZATION_COMPLETED", { status: result?.status || "COMPLETED", engineId: options.fullRecoveryEngine.engineId || "CONFIGURED_ENGINE" });
      return result;
    }
    function snapshot() {
      const execution = executionStore.snapshot();
      return {
        schemaVersion: SCHEMA_VERSION,
        scenario: { scenarioId: run.scenarioId, scenarioHash: scenario.scenarioHash, inputHash: run.inputHash, dataClassification: scenario.dataClassification, boundary: scenario.boundary, sourceType: contextSource },
        plan: { planId: workspace.snapshot().appliedPlan?.planId || plan.planId, planHash: workspace.snapshot().appliedPlan?.planHash || plan.planHash, revision: workspace.snapshot().planRevision, verification: clone((workspace.snapshot().appliedPlan || plan).verification), matrixHash: plan.matrixHash, providerProvenance: clone(plan.providerProvenance), unassignedOrderIds: clone((workspace.snapshot().appliedPlan || plan).unassignedOrderIds || []) },
        execution: clone(execution),
        replay: replay.snapshot(),
        simulation: simulationStore.snapshot(),
        alerts: alertStore.snapshot(),
        incidents: clone(incidents),
        recovery: recovery.session.snapshot(),
        recoveryCandidates: workspace.recoveryCandidates(),
        offline: { queue: offlineQueue.list(), summary: offlineQueue.summary(), driver: driver.viewModel() },
        selected: clone(selected),
        localReviewNotes: Object.fromEntries(localReviewNotes),
        contextTransitions: clone(transitionEvents),
        revision,
      };
    }
    function diagnostics() {
      return {
        schemaVersion: SCHEMA_VERSION,
        singleAuthorities: { operationsWorkspace: 1, executionStore: 1, alertStore: 1, replayController: 1, simulationStore: 1, recoverySession: 1, offlineQueue: 1 },
        sourceVersions: { workspace: workspace.VERSION, reducer: dependencies.Reducer.VERSION, replay: replay.VERSION, alerts: dependencies.Alerts.VERSION, recovery: dependencies.Recovery.VERSION, driver: dependencies.Driver.VERSION },
        mapEngineCreated: 0,
        publicRoutingCalls: 0,
        fixtureBoundary: scenario.boundary,
      };
    }

    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      get scenario() { return scenario; },
      get basePlan() { return plan; },
      get workspace() { return workspace; },
      get executionStore() { return executionStore; },
      get replay() { return replay; },
      get simulationStore() { return simulationStore; },
      get ready() { return simulationReady; },
      get alertStore() { return alertStore; },
      get recoverySession() { return recovery.session; },
      get recoveryFixture() { return recovery; },
      get offlineQueue() { return offlineQueue; },
      get driver() { return driver; },
      get incidents() { return incidents; },
      get revision() { return revision; },
      adoptAppliedPlan,
      select,
      appendExecution,
      addSimulationDelay,
      addIncidentFromAlert,
      continueExecution,
      markReviewNote,
      planActual,
      flightRecorder,
      shiftReview,
      currentTracks,
      pauseForWorkspaceSwitch,
      fullReoptimizationAvailability,
      runFullReoptimization,
      setLocale,
      snapshot,
      diagnostics,
      subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
      notify,
      planning: () => root.STCTPlanning || null,
      optimizer: () => root.STCTOptimizer || null,
      core: () => root.STCTCore || null,
      providerRefs: () => ({ routing: root.STCTV16?.routingProviders || null, matrix: root.STCTV15?.matrixProviders || null, mapLayers: root.STCTV16?.mapLayers || null }),
    });
  }

  return Object.freeze({ SCHEMA_VERSION, planFromScenario, scenarioFromAppliedPlan, recoveryFixture, createContext });
});
