(function (root, factory) {
  "use strict";
  const experience = root?.STCTExperienceFactory || (typeof require === "function" ? require("./experience-v14.js") : null);
  const api = factory(experience);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.STCTScenarioArena = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Experience) {
  "use strict";

  const CHANGE_TYPES = Object.freeze({
    UNCHANGED_ASSIGNMENT: "UNCHANGED_ASSIGNMENT",
    REASSIGNED_ROUTE: "REASSIGNED_ROUTE",
    SEQUENCE_CHANGED: "SEQUENCE_CHANGED",
    NEWLY_ASSIGNED: "NEWLY_ASSIGNED",
    BECAME_UNASSIGNED: "BECAME_UNASSIGNED",
    ROUTE_ADDED: "ROUTE_ADDED",
    ROUTE_REMOVED: "ROUTE_REMOVED",
    VEHICLE_CHANGED: "VEHICLE_CHANGED",
  });
  const METRICS = Object.freeze([
    ["serviceRate", "Service level", "%"],
    ["servicePriorityScore", "Priority score", ""],
    ["assigned", "Assigned", ""],
    ["usedVehicles", "Vehicles", ""],
    ["estimatedRoadKm", "Distance", "km"],
    ["totalCost", "Cost", ""],
    ["totalCO2", "CO2", "kg"],
    ["latestEndMinutes", "Latest end", "min"],
    ["utilizationScore", "Utilization", "%"],
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

  function compare(left, right) {
    if (Experience?.utf8Compare) return Experience.utf8Compare(left, right);
    return text(left).localeCompare(text(right));
  }

  function validation(plan, scenario) {
    return Experience?.verifyPlanShape
      ? Experience.verifyPlanShape(plan, scenario)
      : { status: plan?.verification?.status === "PASS" ? "PASS" : "FAIL", reasons: plan?.verification?.status === "PASS" ? [] : ["VERIFIER_NOT_PASS"] };
  }

  function assertVerified(plan, scenario, side) {
    const result = validation(plan, scenario);
    if (result.status !== "PASS") {
      const error = new Error(`${side || "Plan"} cannot enter Arena: ${result.reasons.join(", ")}`);
      error.code = result.reasons[0] || "INVALID_ARENA_PLAN";
      error.reasons = result.reasons;
      throw error;
    }
    return plan.verification.recomputedMetrics;
  }

  function routeOrderIds(route, plan) {
    if (Array.isArray(route?.orderIds)) return route.orderIds.map(text).filter(Boolean);
    return (plan?.stopGeoJson?.features || [])
      .filter((feature) => text(feature.properties?.routeId) === text(route?.routeId))
      .sort((left, right) => number(left.properties?.seq) - number(right.properties?.seq))
      .map((feature) => text(feature.properties?.orderId)).filter(Boolean);
  }

  function assignmentIndex(plan) {
    const map = new Map();
    (plan?.routes || []).forEach((route) => {
      routeOrderIds(route, plan).forEach((orderId, index) => {
        map.set(orderId, {
          orderId,
          routeId: text(route.routeId),
          vehicleId: text(route.vehicleId),
          seq: index + 1,
        });
      });
    });
    return map;
  }

  function routeIndex(plan) {
    return new Map((plan?.routes || []).map((route) => [text(route.routeId), route]));
  }

  function stopIndex(plan) {
    return new Map((plan?.stopGeoJson?.features || []).map((feature) => [text(feature.properties?.orderId), feature.properties || {}]));
  }

  function changeSet(planA, planB) {
    const left = assignmentIndex(planA);
    const right = assignmentIndex(planB);
    const ids = [...new Set([...left.keys(), ...right.keys(), ...(planA?.unassignedOrderIds || []).map(text), ...(planB?.unassignedOrderIds || []).map(text)])].sort(compare);
    const changes = ids.map((orderId) => {
      const a = left.get(orderId) || null;
      const b = right.get(orderId) || null;
      let type = CHANGE_TYPES.UNCHANGED_ASSIGNMENT;
      if (!a && b) type = CHANGE_TYPES.NEWLY_ASSIGNED;
      else if (a && !b) type = CHANGE_TYPES.BECAME_UNASSIGNED;
      else if (a && b && a.routeId !== b.routeId) type = CHANGE_TYPES.REASSIGNED_ROUTE;
      else if (a && b && a.vehicleId !== b.vehicleId) type = CHANGE_TYPES.VEHICLE_CHANGED;
      else if (a && b && a.seq !== b.seq) type = CHANGE_TYPES.SEQUENCE_CHANGED;
      return { orderId, type, planA: a, planB: b };
    });
    const routesA = routeIndex(planA);
    const routesB = routeIndex(planB);
    [...routesB.keys()].filter((routeId) => !routesA.has(routeId)).sort(compare).forEach((routeId) => {
      changes.push({ orderId: "", routeId, type: CHANGE_TYPES.ROUTE_ADDED, planA: null, planB: { routeId, vehicleId: text(routesB.get(routeId)?.vehicleId) } });
    });
    [...routesA.keys()].filter((routeId) => !routesB.has(routeId)).sort(compare).forEach((routeId) => {
      changes.push({ orderId: "", routeId, type: CHANGE_TYPES.ROUTE_REMOVED, planA: { routeId, vehicleId: text(routesA.get(routeId)?.vehicleId) }, planB: null });
    });
    return changes;
  }

  function metricDelta(metricsA, metricsB, sameInputHash) {
    return METRICS.map(([id, label, unit]) => {
      const left = number(metricsA?.[id]);
      const right = number(metricsB?.[id]);
      const delta = right - left;
      return {
        id,
        label,
        unit,
        planA: left,
        planB: right,
        delta,
        percent: sameInputHash && left !== 0 ? delta / Math.abs(left) * 100 : null,
        semantic: sameInputHash ? "DIRECT_METRIC_DELTA" : "SCENARIO_DELTA",
      };
    });
  }

  function valueDiff(left, right, path = "") {
    if (JSON.stringify(left) === JSON.stringify(right)) return [];
    if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
      return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(compare)
        .flatMap((key) => valueDiff(left[key], right[key], path ? `${path}.${key}` : key));
    }
    return [{ path, planA: clone(left), planB: clone(right) }];
  }

  function scenarioDelta(scenarioA, scenarioB) {
    const ordersA = new Set((scenarioA?.orders || []).map((order) => text(order.id || order.orderId || order.code)));
    const ordersB = new Set((scenarioB?.orders || []).map((order) => text(order.id || order.orderId || order.code)));
    return {
      status: "SCENARIO_CHANGED",
      inputHashA: text(scenarioA?.inputHash),
      inputHashB: text(scenarioB?.inputHash),
      vehicleCountA: scenarioA?.vehicles?.length || 0,
      vehicleCountB: scenarioB?.vehicles?.length || 0,
      addedOrderIds: [...ordersB].filter((id) => !ordersA.has(id)).sort(compare),
      removedOrderIds: [...ordersA].filter((id) => !ordersB.has(id)).sort(compare),
      assumptionChanges: valueDiff(scenarioA?.assumptionsSnapshot || {}, scenarioB?.assumptionsSnapshot || {}),
      constraintChanges: valueDiff(scenarioA?.constraintsSnapshot || {}, scenarioB?.constraintsSnapshot || {}),
    };
  }

  function routeEvidence(route) {
    if (!route) return null;
    return {
      routeId: text(route.routeId),
      vehicleId: text(route.vehicleId),
      volumeUtilization: number(route.volumeUtilization),
      weightUtilization: number(route.weightUtilization),
      returnMinutes: number(route.returnMinutes),
    };
  }

  function whyChanged(change, planA, planB) {
    const routesA = routeIndex(planA);
    const routesB = routeIndex(planB);
    const stopsA = stopIndex(planA);
    const stopsB = stopIndex(planB);
    const leftRoute = change.planA?.routeId ? routesA.get(change.planA.routeId) : null;
    const rightRoute = change.planB?.routeId ? routesB.get(change.planB.routeId) : null;
    const leftStop = stopsA.get(change.orderId) || null;
    const rightStop = stopsB.get(change.orderId) || null;
    const audit = [...(planB?.meta?.manualAdjustmentAudit || []), ...(planB?.meta?.actions || [])]
      .filter((event) => !change.orderId || text(event.orderId) === text(change.orderId));
    return {
      observedChange: {
        type: change.type,
        orderId: change.orderId,
        planA: clone(change.planA),
        planB: clone(change.planB),
      },
      constraintEvidence: {
        routeA: routeEvidence(leftRoute),
        routeB: routeEvidence(rightRoute),
        timeWindowSlackA: leftStop ? number(leftStop.windowEndMinutes, number(leftStop.serviceStartMinutes)) - number(leftStop.serviceStartMinutes) : null,
        timeWindowSlackB: rightStop ? number(rightStop.windowEndMinutes, number(rightStop.serviceStartMinutes)) - number(rightStop.serviceStartMinutes) : null,
        manualAudit: clone(audit),
      },
      notProven: "The optimization cause is not proven beyond observed assignment, sequence, capacity, time-window and audit evidence.",
    };
  }

  function buildComparison(planA, scenarioA, planB, scenarioB = scenarioA) {
    const metricsA = assertVerified(planA, scenarioA, "Plan A");
    const metricsB = assertVerified(planB, scenarioB, "Plan B");
    const sameInputHash = text(planA.inputHash) === text(planB.inputHash);
    const changes = changeSet(planA, planB);
    return {
      version: "stct-arena-v1.4",
      sameInputHash,
      status: sameInputHash ? "COMPARABLE" : "SCENARIO_CHANGED",
      planA: { planId: text(planA.planId), planHash: text(planA.planHash), inputHash: text(planA.inputHash), verificationStatus: planA.verification.status },
      planB: { planId: text(planB.planId), planHash: text(planB.planHash), inputHash: text(planB.inputHash), verificationStatus: planB.verification.status },
      metrics: metricDelta(metricsA, metricsB, sameInputHash),
      changes,
      whyChanged: changes.filter((change) => change.type !== CHANGE_TYPES.UNCHANGED_ASSIGNMENT).map((change) => whyChanged(change, planA, planB)),
      scenarioDelta: sameInputHash ? null : scenarioDelta(scenarioA, scenarioB),
      manualAuditEvidence: clone(planB?.meta?.manualAdjustmentAudit || planB?.meta?.actions || []),
      improvementClaimAllowed: sameInputHash,
    };
  }

  function overlayFeatures(planA, planB) {
    const features = [];
    (planA?.routeGeoJson?.features || []).forEach((feature) => features.push({ ...clone(feature), properties: { ...(feature.properties || {}), arenaSide: "A", arenaStyle: "ghost" } }));
    (planB?.routeGeoJson?.features || []).forEach((feature) => features.push({ ...clone(feature), properties: { ...(feature.properties || {}), arenaSide: "B", arenaStyle: "solid" } }));
    return { type: "FeatureCollection", features };
  }

  function noWebglTable(comparison) {
    return comparison.metrics.map((metric) => ({
      metric: metric.label,
      planA: metric.planA,
      planB: metric.planB,
      delta: metric.delta,
      percent: comparison.sameInputHash ? metric.percent : null,
      semantic: comparison.sameInputHash ? "Verified metric comparison" : "Scenario changed",
    }));
  }

  function exportComparison(comparison) {
    return `${JSON.stringify({ exportedAt: null, ...clone(comparison) }, null, 2)}\n`;
  }

  function createCameraSynchronizer(leftMap, rightMap) {
    let syncing = false;
    let destroyed = false;
    const read = (map) => ({
      center: map.getCenter?.(),
      zoom: map.getZoom?.(),
      bearing: map.getBearing?.(),
      pitch: map.getPitch?.(),
    });
    const copy = (source, target) => {
      if (syncing || destroyed) return;
      syncing = true;
      target.jumpTo?.(read(source));
      syncing = false;
    };
    const leftHandler = () => copy(leftMap, rightMap);
    const rightHandler = () => copy(rightMap, leftMap);
    leftMap.on?.("move", leftHandler);
    rightMap.on?.("move", rightHandler);
    return {
      syncFromLeft: leftHandler,
      syncFromRight: rightHandler,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        leftMap.off?.("move", leftHandler);
        rightMap.off?.("move", rightHandler);
      },
      get destroyed() { return destroyed; },
    };
  }

  function createArenaController({ plans, scenarios, leftPlanHash, rightPlanHash, webglAvailable = true, reducedMotion = false, lowPower = false } = {}) {
    const planMap = new Map((plans || []).map((plan) => [text(plan.planHash), plan]));
    const scenarioMap = new Map((scenarios || []).map((scenario) => [text(scenario.inputHash), scenario]));
    let state = {
      leftPlanHash: text(leftPlanHash || plans?.[0]?.planHash),
      rightPlanHash: text(rightPlanHash || plans?.[1]?.planHash || plans?.[0]?.planHash),
      visualMode: "overlay",
      mobileSide: "A",
      webglAvailable: Boolean(webglAvailable),
      reducedMotion: Boolean(reducedMotion),
      lowPower: Boolean(lowPower),
    };
    function selected() {
      const planA = planMap.get(state.leftPlanHash);
      const planB = planMap.get(state.rightPlanHash);
      if (!planA || !planB) throw new Error("Arena selection references an unknown planHash.");
      return { planA, scenarioA: scenarioMap.get(text(planA.inputHash)), planB, scenarioB: scenarioMap.get(text(planB.inputHash)) };
    }
    function snapshot() {
      const selection = selected();
      return { ...clone(state), comparison: buildComparison(selection.planA, selection.scenarioA, selection.planB, selection.scenarioB), transitionMs: state.reducedMotion ? 0 : 240 };
    }
    function select(side, planHash) {
      if (!planMap.has(text(planHash))) throw new Error(`Unknown Arena planHash: ${planHash}`);
      if (side === "A") state.leftPlanHash = text(planHash);
      else if (side === "B") state.rightPlanHash = text(planHash);
      else throw new Error(`Unknown Arena side: ${side}`);
      return snapshot();
    }
    function setVisualMode(mode) {
      if (!["overlay", "split"].includes(mode)) throw new Error(`Unknown Arena visual mode: ${mode}`);
      state.visualMode = mode === "split" && (!state.webglAvailable || state.lowPower) ? "overlay" : mode;
      return snapshot();
    }
    function setMobileSide(side) {
      if (!["A", "B"].includes(side)) throw new Error(`Unknown mobile Arena side: ${side}`);
      state.mobileSide = side;
      return snapshot();
    }
    return { get state() { return state; }, snapshot, select, setVisualMode, setMobileSide };
  }

  return {
    CHANGE_TYPES,
    METRICS,
    assignmentIndex,
    changeSet,
    metricDelta,
    scenarioDelta,
    whyChanged,
    buildComparison,
    overlayFeatures,
    noWebglTable,
    exportComparison,
    createCameraSynchronizer,
    createArenaController,
  };
});
