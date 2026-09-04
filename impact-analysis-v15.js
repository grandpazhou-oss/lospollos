(function (root, factory) {
  "use strict";
  const incidents = root?.STCTV15?.incidents || (typeof require === "function" ? require("./incident-v15.js") : null);
  const api = factory(incidents);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.impactAnalysis = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (Incidents) {
  "use strict";

  if (!Incidents) throw new Error("Impact Analysis v1.5 requires Incident v1.5.");

  const VERSION = "stct-impact-analysis-v1.5";
  const CONFIDENCE = Object.freeze(["DETERMINISTIC", "PROJECTED", "HEURISTIC", "UNKNOWN"]);

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
    return text(left).localeCompare(text(right), "en");
  }

  function orderId(order) {
    return text(order?.id || order?.orderId || order?.code);
  }

  function vehicleId(vehicle) {
    return text(vehicle?.id || vehicle?.vehicleId || vehicle?.code);
  }

  function timeToMinutes(value, fallback = Infinity) {
    if (Number.isFinite(Number(value))) return Number(value);
    const match = /^(\d{1,2}):(\d{2})$/.exec(text(value));
    return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
  }

  function routeOrderIds(route, plan) {
    if (Array.isArray(route?.orderIds)) return route.orderIds.map(text).filter(Boolean);
    return (plan?.stopGeoJson?.features || [])
      .filter((feature) => text(feature.properties?.routeId) === text(route?.routeId))
      .sort((a, b) => number(a.properties?.seq) - number(b.properties?.seq))
      .map((feature) => text(feature.properties?.orderId)).filter(Boolean);
  }

  function stopRows(plan) {
    const byRoute = new Map();
    (plan?.routes || []).forEach((route) => {
      const cached = (plan?.stopGeoJson?.features || [])
        .filter((feature) => text(feature.properties?.routeId) === text(route.routeId))
        .sort((a, b) => number(a.properties?.seq) - number(b.properties?.seq))
        .map((feature) => ({
          routeId: text(route.routeId),
          vehicleId: text(route.vehicleId),
          orderId: text(feature.properties?.orderId),
          sequence: number(feature.properties?.seq),
          rawArrivalMinute: number(feature.properties?.rawArrivalMinutes, number(feature.properties?.serviceStartMinutes)),
          serviceStartMinute: number(feature.properties?.serviceStartMinutes, number(feature.properties?.rawArrivalMinutes)),
          departureMinute: number(feature.properties?.departureMinutes, number(feature.properties?.serviceStartMinutes)),
        }));
      if (cached.length) byRoute.set(text(route.routeId), cached);
      else {
        let cursor = number(route.startMinutes, 0);
        const generated = routeOrderIds(route, plan).map((id, index) => {
          cursor += 15;
          const serviceStartMinute = cursor;
          cursor += 10;
          return { routeId: text(route.routeId), vehicleId: text(route.vehicleId), orderId: id, sequence: index + 1, rawArrivalMinute: serviceStartMinute, serviceStartMinute, departureMinute: cursor };
        });
        byRoute.set(text(route.routeId), generated);
      }
    });
    return byRoute;
  }

  function assignmentIndex(plan) {
    const result = new Map();
    (plan?.routes || []).forEach((route) => routeOrderIds(route, plan).forEach((id, index) => result.set(id, {
      orderId: id,
      routeId: text(route.routeId),
      vehicleId: text(route.vehicleId),
      sequence: index + 1,
    })));
    return result;
  }

  function createPinningSnapshot(plan, incidentMinute, options = {}) {
    const minute = number(incidentMinute, NaN);
    if (!Number.isFinite(minute) || minute < 0) throw Object.assign(new Error("Pinning incidentMinute must be a non-negative finite number."), { code: "PINNING_MINUTE_INVALID" });
    const schedules = stopRows(plan);
    const completedStopIds = [];
    const activeServiceStopIds = [];
    const fixedRoutePrefixes = [];
    (plan?.routes || []).forEach((route) => {
      const rows = schedules.get(text(route.routeId)) || [];
      const completed = rows.filter((row) => row.departureMinute <= minute).map((row) => row.orderId);
      const active = rows.filter((row) => row.serviceStartMinute <= minute && minute < row.departureMinute).map((row) => row.orderId);
      completedStopIds.push(...completed);
      activeServiceStopIds.push(...active);
      const prefixLength = Math.max(completed.length, active.length ? rows.findIndex((row) => row.orderId === active[0]) + 1 : 0);
      if (prefixLength) fixedRoutePrefixes.push({
        routeId: text(route.routeId),
        vehicleId: text(route.vehicleId),
        orderIds: rows.slice(0, prefixLength).map((row) => row.orderId),
        completedOrderIds: completed,
        activeServiceOrderIds: active,
      });
    });
    const lockedRouteIds = [...new Set((options.lockedRouteIds || []).map(text).filter(Boolean))].sort(compare);
    const baseAssignments = assignmentIndex(plan);
    const lockedOrderIds = new Set([...(options.lockedOrderIds || []).map(text), ...completedStopIds, ...activeServiceStopIds]);
    lockedRouteIds.forEach((routeId) => {
      const route = (plan?.routes || []).find((row) => text(row.routeId) === routeId);
      routeOrderIds(route, plan).forEach((id) => lockedOrderIds.add(id));
    });
    const snapshot = {
      version: VERSION,
      incidentMinute: minute,
      basePlanHash: text(plan?.planHash),
      completedStopIds: [...new Set(completedStopIds)].sort(compare),
      activeServiceStopIds: [...new Set(activeServiceStopIds)].sort(compare),
      fixedRoutePrefixes: fixedRoutePrefixes.sort((a, b) => compare(a.routeId, b.routeId)),
      lockedRouteIds,
      lockedOrderIds: [...lockedOrderIds].filter(Boolean).sort(compare),
      baseAssignments: Object.fromEntries([...baseAssignments.entries()].sort(([a], [b]) => compare(a, b))),
      activeServiceDefaultPinned: true,
    };
    snapshot.pinningHash = Incidents.hashValue(snapshot);
    return snapshot;
  }

  function verifyCandidatePinning(basePlan, candidatePlan, pinning) {
    const violations = [];
    const baseRoutes = new Map((basePlan?.routes || []).map((route) => [text(route.routeId), route]));
    const candidateRoutes = new Map((candidatePlan?.routes || []).map((route) => [text(route.routeId), route]));
    const candidateAssignments = assignmentIndex(candidatePlan);
    (pinning?.fixedRoutePrefixes || []).forEach((prefix) => {
      const candidate = candidateRoutes.get(prefix.routeId);
      const ids = routeOrderIds(candidate, candidatePlan);
      if (!candidate) violations.push({ code: "PINNED_ROUTE_PREFIX_MISSING", routeId: prefix.routeId });
      else {
        if (text(candidate.vehicleId) !== prefix.vehicleId) violations.push({ code: "PINNED_ROUTE_VEHICLE_CHANGED", routeId: prefix.routeId, expected: prefix.vehicleId, actual: text(candidate.vehicleId) });
        prefix.orderIds.forEach((id, index) => {
          if (ids[index] !== id) violations.push({ code: "PINNED_ROUTE_PREFIX_CHANGED", routeId: prefix.routeId, orderId: id, sequence: index + 1, actual: ids[index] || "" });
        });
      }
    });
    (pinning?.lockedRouteIds || []).forEach((routeId) => {
      const base = baseRoutes.get(routeId);
      const candidate = candidateRoutes.get(routeId);
      const baseIds = routeOrderIds(base, basePlan);
      const candidateIds = routeOrderIds(candidate, candidatePlan);
      if (!candidate || text(candidate.vehicleId) !== text(base?.vehicleId) || JSON.stringify(candidateIds) !== JSON.stringify(baseIds)) {
        violations.push({ code: "LOCKED_ROUTE_CHANGED", routeId, expectedVehicleId: text(base?.vehicleId), actualVehicleId: text(candidate?.vehicleId), expectedOrderIds: baseIds, actualOrderIds: candidateIds });
      }
    });
    (pinning?.lockedOrderIds || []).forEach((id) => {
      const expected = pinning.baseAssignments?.[id];
      const actual = candidateAssignments.get(id);
      if (!expected || !actual || expected.routeId !== actual.routeId || expected.vehicleId !== actual.vehicleId || expected.sequence !== actual.sequence) {
        violations.push({ code: "LOCKED_ORDER_MOVED", orderId: id, expected: clone(expected), actual: clone(actual || null) });
      }
    });
    return { status: violations.length ? "FAIL" : "PASS", violations, checkedPrefixCount: pinning?.fixedRoutePrefixes?.length || 0, checkedLockedRouteCount: pinning?.lockedRouteIds?.length || 0 };
  }

  function targetId(incident, key) {
    return text(incident?.parameters?.[key] || incident?.affectedEntityIds?.[0]);
  }

  function metric(value, confidence, evidence = []) {
    return { value, confidence, evidence: clone(evidence) };
  }

  function computeBlastRadius(options = {}) {
    const basePlan = options.basePlan || {};
    const baseScenario = options.baseScenario || {};
    const derivedScenario = options.derivedScenario || baseScenario;
    const incidents = Array.isArray(options.incidents) ? options.incidents : [options.incident].filter(Boolean);
    const pinning = options.pinning || createPinningSnapshot(basePlan, incidents[0]?.logicalMinute || 0, options);
    const assignments = assignmentIndex(basePlan);
    const schedules = stopRows(basePlan);
    const affectedRoutes = new Set();
    const affectedVehicles = new Set();
    const affectedOrders = new Set();
    const repairSet = new Set();
    const insertionSet = new Set();
    const lateRisk = new Set();
    const missedWindow = new Set();
    const capacityRisk = new Set();
    const reasons = [];
    const delayByRoute = new Map();

    incidents.forEach((incident) => {
      if (incident.type === "VEHICLE_BREAKDOWN") {
        const id = targetId(incident, "vehicleId");
        affectedVehicles.add(id);
        (basePlan.routes || []).filter((route) => text(route.vehicleId) === id).forEach((route) => {
          const routeId = text(route.routeId);
          affectedRoutes.add(routeId);
          const prefix = pinning.fixedRoutePrefixes.find((row) => row.routeId === routeId)?.orderIds || [];
          routeOrderIds(route, basePlan).filter((order) => !prefix.includes(order)).forEach((order) => { affectedOrders.add(order); repairSet.add(order); });
          capacityRisk.add(routeId);
        });
        reasons.push({ type: incident.type, confidence: "DETERMINISTIC", evidence: { vehicleId: id, disabledInDerivedScenario: true } });
      } else if (incident.type === "STOP_DELAY") {
        const id = targetId(incident, "orderId");
        const assignment = assignments.get(id);
        if (assignment) {
          affectedRoutes.add(assignment.routeId);
          affectedVehicles.add(assignment.vehicleId);
          const rows = schedules.get(assignment.routeId) || [];
          rows.filter((row) => row.sequence >= assignment.sequence).forEach((row) => affectedOrders.add(row.orderId));
          delayByRoute.set(assignment.routeId, number(delayByRoute.get(assignment.routeId)) + number(incident.parameters.delayMinutes));
        }
        reasons.push({ type: incident.type, confidence: "PROJECTED", evidence: { orderId: id, delayMinutes: number(incident.parameters.delayMinutes) } });
      } else if (incident.type === "EMERGENCY_ORDER") {
        const id = orderId(incident.parameters.order);
        insertionSet.add(id);
        affectedOrders.add(id);
        reasons.push({ type: incident.type, confidence: "DETERMINISTIC", evidence: { addedOrderId: id } });
      } else if (incident.type === "ORDER_CANCELLED") {
        const id = targetId(incident, "orderId");
        const assignment = assignments.get(id);
        affectedOrders.add(id);
        if (assignment) {
          affectedRoutes.add(assignment.routeId);
          affectedVehicles.add(assignment.vehicleId);
        }
        reasons.push({ type: incident.type, confidence: "DETERMINISTIC", evidence: { removedOrderId: id } });
      } else if (incident.type === "TIME_WINDOW_CHANGED") {
        const id = targetId(incident, "orderId");
        const assignment = assignments.get(id);
        affectedOrders.add(id);
        if (assignment) {
          affectedRoutes.add(assignment.routeId);
          affectedVehicles.add(assignment.vehicleId);
        }
        reasons.push({ type: incident.type, confidence: "PROJECTED", evidence: { orderId: id, twStart: incident.parameters.twStart, twEnd: incident.parameters.twEnd } });
      } else if (incident.type === "DEPOT_DELAY") {
        (basePlan.routes || []).forEach((route) => {
          const routeId = text(route.routeId);
          affectedRoutes.add(routeId);
          affectedVehicles.add(text(route.vehicleId));
          delayByRoute.set(routeId, number(delayByRoute.get(routeId)) + number(incident.parameters.delayMinutes));
          routeOrderIds(route, basePlan).filter((id) => !pinning.completedStopIds.includes(id)).forEach((id) => affectedOrders.add(id));
        });
        reasons.push({ type: incident.type, confidence: "PROJECTED", evidence: { delayMinutes: number(incident.parameters.delayMinutes) } });
      } else if (incident.type === "ROAD_CLOSURE_SIMULATION") {
        const routeId = targetId(incident, "routeId");
        const route = (basePlan.routes || []).find((row) => text(row.routeId) === routeId);
        if (route) {
          affectedRoutes.add(routeId);
          affectedVehicles.add(text(route.vehicleId));
          routeOrderIds(route, basePlan).forEach((id) => affectedOrders.add(id));
          delayByRoute.set(routeId, number(delayByRoute.get(routeId)) + number(incident.parameters.delayMinutes));
        }
        reasons.push({ type: incident.type, confidence: "HEURISTIC", evidence: { routeId, simulationOnly: true, realTimeRoadClosure: false } });
      }
    });

    const derivedOrders = new Map((derivedScenario.orders || []).map((order) => [orderId(order), order]));
    affectedRoutes.forEach((routeId) => {
      const delay = number(delayByRoute.get(routeId));
      (schedules.get(routeId) || []).forEach((stop) => {
        if (!affectedOrders.has(stop.orderId)) return;
        const order = derivedOrders.get(stop.orderId);
        if (!order) return;
        const projectedStart = stop.serviceStartMinute + delay;
        const end = timeToMinutes(order.twEnd);
        if (Number.isFinite(end) && projectedStart > end) missedWindow.add(stop.orderId);
        else if (Number.isFinite(end) && projectedStart > end - 20) lateRisk.add(stop.orderId);
      });
    });
    incidents.filter((incident) => incident.type === "TIME_WINDOW_CHANGED").forEach((incident) => {
      const id = targetId(incident, "orderId");
      const assignment = assignments.get(id);
      const stop = (schedules.get(assignment?.routeId) || []).find((row) => row.orderId === id);
      const order = derivedOrders.get(id);
      if (stop && order && stop.serviceStartMinute > timeToMinutes(order.twEnd)) missedWindow.add(id);
    });

    const baseMetrics = basePlan.verification?.recomputedMetrics || basePlan.metrics || {};
    const projectedDelay = [...delayByRoute.values()].reduce((sum, value) => sum + value, 0);
    const impact = {
      version: VERSION,
      basePlanHash: text(basePlan.planHash),
      baseInputHash: text(baseScenario.inputHash),
      derivedInputHash: text(derivedScenario.inputHash),
      incidentHashes: incidents.map((incident) => incident.incidentHash),
      pinningHash: text(pinning.pinningHash),
      affectedRouteIds: [...affectedRoutes].sort(compare),
      affectedVehicleIds: [...affectedVehicles].sort(compare),
      affectedOrderIds: [...affectedOrders].sort(compare),
      lateRiskOrderIds: [...lateRisk].sort(compare),
      missedWindowOrderIds: [...missedWindow].sort(compare),
      capacityRiskRouteIds: [...capacityRisk].sort(compare),
      repairSetOrderIds: [...repairSet].sort(compare),
      insertionSetOrderIds: [...insertionSet].sort(compare),
      metrics: {
        unassignedIncrease: metric(repairSet.size, "PROJECTED", ["Breakdown repair set is not yet reinserted"]),
        servicePriorityImpact: metric([...repairSet].reduce((sum, id) => sum + number(derivedOrders.get(id)?.priorityWeight, 1), 0), "PROJECTED"),
        distanceDelta: metric(null, "UNKNOWN", ["Requires a verified recovery candidate"]),
        costDelta: metric(null, "UNKNOWN", ["Requires a verified recovery candidate"]),
        co2Delta: metric(null, "UNKNOWN", ["Requires a verified recovery candidate"]),
        latestEndDelta: metric(projectedDelay, delayByRoute.size ? "PROJECTED" : "UNKNOWN"),
        changeCount: metric(affectedOrders.size, "HEURISTIC", ["Blast radius count is not final plan disruption"]),
        baseAssigned: metric(number(baseMetrics.assigned), "DETERMINISTIC"),
      },
      confidenceLegend: clone(CONFIDENCE),
      reasons,
    };
    impact.blastRadiusHash = Incidents.hashValue(impact);
    return impact;
  }

  function noWebglTable(impact) {
    return [
      ["Affected routes", impact.affectedRouteIds, "DETERMINISTIC"],
      ["Affected vehicles", impact.affectedVehicleIds, "DETERMINISTIC"],
      ["Affected orders", impact.affectedOrderIds, "DETERMINISTIC"],
      ["Late-risk orders", impact.lateRiskOrderIds, "PROJECTED"],
      ["Missed-window orders", impact.missedWindowOrderIds, "PROJECTED"],
      ["Capacity-risk routes", impact.capacityRiskRouteIds, "PROJECTED"],
    ].map(([metricName, values, confidence]) => ({ metric: metricName, value: values.length, entityIds: clone(values), confidence }));
  }

  function routeMorph(basePlan, recoveryPlan, options = {}) {
    const before = assignmentIndex(basePlan);
    const after = assignmentIndex(recoveryPlan);
    const ids = [...new Set([...before.keys(), ...after.keys()])].sort(compare);
    const changes = ids.map((id) => {
      const source = before.get(id) || null;
      const target = after.get(id) || null;
      let type = "UNCHANGED";
      if (!source && target) type = "NEWLY_ASSIGNED";
      else if (source && !target) type = "NEWLY_UNASSIGNED";
      else if (source.routeId !== target.routeId || source.vehicleId !== target.vehicleId) type = "MOVED";
      else if (source.sequence !== target.sequence) type = "RESEQUENCED";
      return { orderId: id, type, before: clone(source), after: clone(target) };
    });
    return {
      version: VERSION,
      basePlanHash: text(basePlan?.planHash),
      recoveryPlanHash: text(recoveryPlan?.planHash),
      mode: options.reducedMotion ? "STATIC_BEFORE_AFTER" : "ROUTE_MORPH",
      businessStateMutated: false,
      unchangedOrderIds: changes.filter((row) => row.type === "UNCHANGED").map((row) => row.orderId),
      changes: changes.filter((row) => row.type !== "UNCHANGED"),
    };
  }

  return {
    VERSION,
    CONFIDENCE,
    routeOrderIds,
    stopRows,
    assignmentIndex,
    createPinningSnapshot,
    verifyCandidatePinning,
    computeBlastRadius,
    noWebglTable,
    routeMorph,
  };
});
