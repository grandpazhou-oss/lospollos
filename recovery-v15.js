(function (root, factory) {
  "use strict";
  const events = root?.STCTV15?.domainEvents || (typeof require === "function" ? require("./domain-events-v15.js") : null);
  const incidents = root?.STCTV15?.incidents || (typeof require === "function" ? require("./incident-v15.js") : null);
  const impact = root?.STCTV15?.impactAnalysis || (typeof require === "function" ? require("./impact-analysis-v15.js") : null);
  const matrices = root?.STCTV15?.matrixProviders || (typeof require === "function" ? require("./matrix-provider-v15.js") : null);
  const api = factory(events, incidents, impact, matrices);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.recovery = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (DomainEvents, Incidents, Impact, Matrices) {
  "use strict";

  if (!DomainEvents || !Incidents || !Impact || !Matrices) throw new Error("Recovery v1.5.1 requires Domain Events, Incident, Impact Analysis, and Matrix Provider contracts.");

  const VERSION = "stct-recovery-v1.5";
  const OBJECTIVES = Object.freeze(["MINIMUM_CHANGE", "BEST_SERVICE", "LEAST_DELAY", "LOWEST_COST", "BALANCED_RECOVERY"]);
  const METHODS = Object.freeze(["CARRY_FORWARD_REFERENCE", "LOCAL_REGRET_INSERTION", "LOCAL_RUIN_AND_RECREATE", "FULL_REOPTIMIZATION"]);
  const BALANCED_WEIGHTS = Object.freeze({ service: 40, delay: 18, change: 18, cost: 12, carbon: 7, vehicles: 5 });

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

  function error(code, message, detail = {}) {
    const result = new Error(message);
    result.code = code;
    result.detail = clone(detail);
    return result;
  }

  function orderId(order) {
    return text(order?.id || order?.orderId || order?.code);
  }

  function vehicleId(vehicle) {
    return text(vehicle?.id || vehicle?.vehicleId || vehicle?.code);
  }

  function timeToMinutes(value, fallback = 0) {
    if (Number.isFinite(Number(value))) return Number(value);
    const match = /^(\d{1,2}):(\d{2})$/.exec(text(value));
    return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
  }

  function timeText(minutes) {
    const value = Math.max(0, Math.round(number(minutes)));
    return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  }

  function haversineKm(a, b) {
    const radius = 6371;
    const toRad = (value) => value * Math.PI / 180;
    const lat1 = toRad(number(a?.[1]));
    const lat2 = toRad(number(b?.[1]));
    const dLat = lat2 - lat1;
    const dLon = toRad(number(b?.[0]) - number(a?.[0]));
    const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
  }

  function createRecoveryRequest(specification = {}) {
    const objective = text(specification.objective).toUpperCase();
    if (!OBJECTIVES.includes(objective)) throw error("RECOVERY_OBJECTIVE_UNKNOWN", `Unknown recovery objective: ${objective}`);
    const semantic = {
      version: VERSION,
      basePlanHash: text(specification.basePlanHash),
      derivedInputHash: text(specification.derivedInputHash),
      incidentHash: text(specification.incidentHash),
      objective,
      pinningSnapshot: clone(specification.pinningSnapshot || {}),
      engine: clone(specification.engine || { id: "DEMO_HEURISTIC", version: "1.5", status: "AVAILABLE" }),
      matrixProvider: clone(specification.matrixProvider || { id: "HAVERSINE_FALLBACK", version: "1.5", status: "AVAILABLE" }),
      solveOptions: clone(specification.solveOptions || {}),
    };
    if (!semantic.basePlanHash || !semantic.derivedInputHash || !semantic.incidentHash || !text(semantic.pinningSnapshot.pinningHash)) {
      throw error("RECOVERY_REQUEST_IDENTITY_REQUIRED", "Recovery request requires base plan, derived input, incident, and pinning identity.");
    }
    return { ...semantic, recoveryRequestHash: Incidents.hashValue(semantic) };
  }

  function maps(scenario) {
    return {
      orders: new Map((scenario?.orders || []).map((order) => [orderId(order), order])),
      vehicles: new Map((scenario?.vehicles || []).map((vehicle) => [vehicleId(vehicle), vehicle])),
    };
  }

  function routeSeed(plan) {
    return (plan?.routes || []).map((route) => ({
      routeId: text(route.routeId),
      vehicleId: text(route.vehicleId),
      color: text(route.color || "#003b79"),
      orderIds: Impact.routeOrderIds(route, plan),
      historicalOnly: Boolean(route.historicalOnly),
    }));
  }

  function assumptions(scenario) {
    const source = scenario?.assumptionsSnapshot || scenario?.assumptions || {};
    const constraints = scenario?.constraintsSnapshot || scenario?.constraints || {};
    return {
      roadDistanceFactor: number(source.roadDistanceFactor ?? constraints.roadDistanceFactor, 1.35),
      averageSpeedKmh: Math.max(1, number(source.averageSpeedKmh ?? constraints.averageSpeedKmh, 28)),
      defaultServiceMin: Math.max(0, number(source.defaultServiceMin ?? source.defaultServiceMinutes ?? constraints.defaultServiceMinutes, 5)),
      maxWaitingMinutes: Math.max(0, number(constraints.maxWaitingMinutes, 120)),
      depotDelayMinutes: Math.max(0, number(constraints.depotDelayMinutes)),
    };
  }

  function evaluateRoute(route, scenario, options = {}) {
    const lookup = maps(scenario);
    const model = assumptions(scenario);
    const vehicle = lookup.vehicles.get(text(route.vehicleId));
    if (!vehicle) return { status: "FAIL", violations: [{ code: "UNKNOWN_VEHICLE_ID", vehicleId: route.vehicleId }] };
    const historical = route.historicalOnly === true;
    if (vehicle.enabled === false && !historical) return { status: "FAIL", violations: [{ code: "VEHICLE_UNAVAILABLE", vehicleId: route.vehicleId }] };
    const matrixContext = options.matrixContext;
    if (!matrixContext?.leg || !text(matrixContext.depotId)) throw error("RECOVERY_MATRIX_CONTEXT_REQUIRED", "Recovery route evaluation requires an injected MatrixContext.");
    const depot = [number(scenario?.depot?.lon), number(scenario?.depot?.lat)];
    let priorId = matrixContext.depotId;
    let cursor = timeToMinutes(vehicle.start, timeToMinutes(scenario?.constraintsSnapshot?.workStart, 0)) + model.depotDelayMinutes;
    let distanceKm = 0;
    let drivingMinutes = 0;
    let volume = 0;
    let weight = 0;
    let packages = 0;
    const violations = [];
    const stops = [];
    const coordinates = [depot];
    (route.orderIds || []).forEach((id, index) => {
      const order = lookup.orders.get(text(id)) || options.baseOrderMap?.get(text(id));
      if (!order) {
        violations.push({ code: "UNKNOWN_ORDER_ID", orderId: id });
        return;
      }
      const coordinate = [number(order.lon, NaN), number(order.lat, NaN)];
      if (!coordinate.every(Number.isFinite)) {
        violations.push({ code: "INVALID_ORDER_COORDINATE", orderId: id });
        return;
      }
      let leg;
      try { leg = matrixContext.leg(priorId, text(id)); }
      catch (caught) { violations.push({ code: text(caught.code || "MATRIX_LEG_UNAVAILABLE"), orderId: id, fromId: priorId, toId: text(id) }); return; }
      const legKm = leg.distanceKm;
      const travelMinutes = Math.ceil(leg.durationMinutes);
      const rawArrival = cursor + travelMinutes;
      const windowStart = timeToMinutes(order.twStart, 0);
      let windowEnd = timeToMinutes(order.twEnd, 24 * 60);
      if (windowEnd < windowStart) windowEnd += 24 * 60;
      const serviceStart = Math.max(rawArrival, windowStart);
      const waitingMinutes = serviceStart - rawArrival;
      const serviceMinutes = Math.max(0, number(order.serviceMin, model.defaultServiceMin));
      const departureMinutes = serviceStart + serviceMinutes;
      if (!historical && waitingMinutes > model.maxWaitingMinutes) violations.push({ code: "MAX_WAIT_EXCEEDED", orderId: id, waitingMinutes, maximum: model.maxWaitingMinutes });
      if (!historical && serviceStart > windowEnd) violations.push({ code: "TIME_WINDOW_VIOLATION", orderId: id, serviceStart, windowEnd });
      distanceKm += legKm;
      drivingMinutes += travelMinutes;
      volume += number(order.volume);
      weight += number(order.weight);
      packages += number(order.count);
      stops.push({ orderId: text(id), sequence: index + 1, routeId: route.routeId, vehicleId: route.vehicleId, rawArrivalMinutes: rawArrival, waitingMinutes, serviceStartMinutes: serviceStart, departureMinutes, travelMinutes, travelKm: legKm, coordinate });
      coordinates.push(coordinate);
      priorId = text(id);
      cursor = departureMinutes;
    });
    let returnKm = 0; let returnTravel = 0;
    if (route.orderIds?.length && !violations.some((row) => row.code.includes("MATRIX"))) {
      try { const leg = matrixContext.leg(priorId, matrixContext.depotId); returnKm = leg.distanceKm; returnTravel = Math.ceil(leg.durationMinutes); }
      catch (caught) { violations.push({ code: text(caught.code || "MATRIX_LEG_UNAVAILABLE"), fromId: priorId, toId: matrixContext.depotId }); }
    }
    distanceKm += returnKm;
    drivingMinutes += returnTravel;
    cursor += returnTravel;
    coordinates.push(depot);
    if (!historical && volume > number(vehicle.maxVolume)) violations.push({ code: "ROUTE_VOLUME_CAPACITY_EXCEEDED", actual: volume, capacity: number(vehicle.maxVolume) });
    if (!historical && weight > number(vehicle.maxWeight)) violations.push({ code: "ROUTE_WEIGHT_CAPACITY_EXCEEDED", actual: weight, capacity: number(vehicle.maxWeight) });
    const fixedCost = number(vehicle.fixedCost);
    const cost = fixedCost + distanceKm * number(vehicle.perKmCost) + drivingMinutes * number(vehicle.perMinuteCost) + (route.orderIds?.length || 0) * number(vehicle.perStopCost);
    const co2 = distanceKm * number(vehicle.emissionFactor, number(scenario?.assumptionsSnapshot?.defaultEmissionFactor, 0.192));
    return {
      status: violations.length ? "FAIL" : "PASS",
      violations,
      route: {
        ...clone(route),
        orderIds: [...(route.orderIds || [])],
        orders: route.orderIds?.length || 0,
        stops: route.orderIds?.length || 0,
        packages,
        volume,
        weight,
        maxVolume: number(vehicle.maxVolume),
        maxWeight: number(vehicle.maxWeight),
        volumeUtilization: number(vehicle.maxVolume) ? volume / number(vehicle.maxVolume) * 100 : 0,
        weightUtilization: number(vehicle.maxWeight) ? weight / number(vehicle.maxWeight) * 100 : 0,
        km: distanceKm,
        roadMeters: Math.round(distanceKm * 1000),
        drivingMinutes,
        startMinutes: timeToMinutes(vehicle.start, 0),
        returnMinutes: cursor,
        start: timeText(timeToMinutes(vehicle.start, 0)),
        end: timeText(cursor),
        estimatedCost: cost,
        estimatedCo2: co2,
      },
      stops,
      coordinates,
    };
  }

  function objectiveScore(option, objective, originalAssignment, order) {
    const moved = originalAssignment && (originalAssignment.routeId !== option.routeId || originalAssignment.sequence !== option.index + 1) ? 1 : 0;
    const priority = number(order?.priorityWeight, 1);
    if (objective === "MINIMUM_CHANGE") return moved * 100000 + option.deltaDistanceKm * 100 + option.latestEndMinute;
    if (objective === "BEST_SERVICE") return -priority * 100000 + option.latestEndMinute * 10 + option.deltaDistanceKm;
    if (objective === "LEAST_DELAY") return option.latestEndMinute * 100 + option.deltaDistanceKm;
    if (objective === "LOWEST_COST") return option.deltaCost * 100 + option.deltaDistanceKm;
    return option.deltaDistanceKm * BALANCED_WEIGHTS.cost + option.latestEndMinute / 60 * BALANCED_WEIGHTS.delay + moved * BALANCED_WEIGHTS.change - priority * BALANCED_WEIGHTS.service;
  }

  function insertionOptions(orderIdValue, routes, scenario, context = {}) {
    const lookup = maps(scenario);
    const order = lookup.orders.get(text(orderIdValue));
    if (!order) return [];
    const original = Impact.assignmentIndex(context.basePlan || {}).get(text(orderIdValue));
    const options = [];
    routes.forEach((route) => {
      if (route.historicalOnly) return;
      const prefix = context.pinning?.fixedRoutePrefixes?.find((row) => row.routeId === route.routeId)?.orderIds?.length || 0;
      for (let index = prefix; index <= route.orderIds.length; index += 1) {
        const ids = [...route.orderIds];
        ids.splice(index, 0, text(orderIdValue));
        const before = evaluateRoute(route, scenario, context);
        const after = evaluateRoute({ ...route, orderIds: ids }, scenario, context);
        if (after.status !== "PASS") continue;
        const option = {
          orderId: text(orderIdValue),
          routeId: route.routeId,
          vehicleId: route.vehicleId,
          index,
          orderIds: ids,
          deltaDistanceKm: number(after.route.km) - number(before.route?.km),
          deltaCost: number(after.route.estimatedCost) - number(before.route?.estimatedCost),
          latestEndMinute: number(after.route.returnMinutes),
        };
        option.score = objectiveScore(option, context.objective || "BALANCED_RECOVERY", original, order);
        options.push(option);
      }
    });
    return options.sort((a, b) => a.score - b.score || compare(a.routeId, b.routeId) || a.index - b.index);
  }

  function regretInsertion(orderIds, routeSource, scenario, context = {}) {
    const routes = clone(routeSource || []);
    const pending = [...new Set((orderIds || []).map(text).filter(Boolean))];
    const decisions = [];
    const unassigned = [];
    while (pending.length) {
      const evaluated = pending.map((id) => {
        const options = insertionOptions(id, routes, scenario, context);
        const best = options[0] || null;
        const secondBest = options[1] || null;
        const regret = best ? secondBest ? secondBest.score - best.score : Number.MAX_SAFE_INTEGER : -1;
        return { orderId: id, options, best, secondBest, regret };
      }).sort((a, b) => b.regret - a.regret || compare(a.orderId, b.orderId));
      const selected = evaluated[0];
      pending.splice(pending.indexOf(selected.orderId), 1);
      if (!selected.best) {
        unassigned.push({ orderId: selected.orderId, reasonCode: "NO_FEASIBLE_INSERTION", confidence: "DETERMINISTIC_LOCAL_CHECK" });
        decisions.push({ orderId: selected.orderId, best: null, secondBest: null, regret: null, status: "UNASSIGNED" });
        continue;
      }
      const route = routes.find((row) => row.routeId === selected.best.routeId);
      route.orderIds = selected.best.orderIds;
      decisions.push({ orderId: selected.orderId, best: clone(selected.best), secondBest: clone(selected.secondBest), regret: selected.regret, status: "INSERTED" });
    }
    return { routes, decisions, unassigned };
  }

  function localRuinAndRecreateSeed(basePlan, blastRadius, pinning, derivedScenario) {
    const routes = routeSeed(basePlan);
    const ruin = new Set([...(blastRadius?.repairSetOrderIds || []), ...(blastRadius?.insertionSetOrderIds || []), ...(blastRadius?.missedWindowOrderIds || [])]);
    const cancelled = new Set(basePlan.routes?.flatMap((route) => Impact.routeOrderIds(route, basePlan)).filter((id) => !(derivedScenario.orders || []).some((order) => orderId(order) === id)) || []);
    routes.forEach((route) => {
      const prefix = pinning.fixedRoutePrefixes.find((row) => row.routeId === route.routeId)?.orderIds || [];
      const vehicle = (derivedScenario.vehicles || []).find((row) => vehicleId(row) === route.vehicleId);
      if (vehicle?.enabled === false) {
        route.orderIds = route.orderIds.filter((id) => prefix.includes(id));
        route.historicalOnly = route.orderIds.length > 0;
      } else route.orderIds = route.orderIds.filter((id) => !ruin.has(id) && !cancelled.has(id));
    });
    const assigned = new Set(routes.flatMap((route) => route.orderIds));
    const repairOrderIds = [...ruin].filter((id) => (derivedScenario.orders || []).some((order) => orderId(order) === id) && !assigned.has(id)).sort(compare);
    return { routes: routes.filter((route) => route.orderIds.length || !route.historicalOnly), repairOrderIds, ruinedOrderIds: [...ruin].sort(compare), cancelledOrderIds: [...cancelled].sort(compare) };
  }

  function materializePlan(routeSource, unassignedRows, scenario, basePlan, metadata = {}) {
    const baseOrderMap = new Map((metadata.baseScenario?.orders || []).map((order) => [orderId(order), order]));
    const routeResults = routeSource.map((route) => evaluateRoute(route, scenario, { baseOrderMap, matrixContext: metadata.matrixContext }));
    const routes = routeResults.filter((result) => result.route).map((result) => result.route);
    const stopFeatures = routeResults.flatMap((result) => (result.stops || []).map((stop) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: stop.coordinate },
      properties: { ...stop, seq: stop.sequence, arrive: timeText(stop.serviceStartMinutes), depart: timeText(stop.departureMinutes) },
    })));
    const routeFeatures = routeResults.filter((result) => result.route).map((result) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: result.coordinates },
      properties: clone(result.route),
    }));
    const assignedIds = routes.flatMap((route) => route.orderIds);
    const unassignedOrderIds = [...new Set((unassignedRows || []).map((row) => text(row.orderId || row)).filter(Boolean))].sort(compare);
    const orderMap = maps(scenario).orders;
    const assignedPriority = assignedIds.reduce((sum, id) => sum + number(orderMap.get(id)?.priorityWeight, 1), 0);
    const totalVolume = routes.reduce((sum, route) => sum + number(route.volume), 0);
    const totalCapacity = routes.reduce((sum, route) => sum + number(route.maxVolume), 0);
    const metrics = {
      assigned: assignedIds.length,
      unassigned: unassignedOrderIds.length,
      blocked: 0,
      servicePriorityScore: assignedPriority,
      usedVehicles: routes.filter((route) => route.orderIds.length).length,
      estimatedRoadKm: routes.reduce((sum, route) => sum + number(route.km), 0),
      totalCost: routes.reduce((sum, route) => sum + number(route.estimatedCost), 0),
      totalCO2: routes.reduce((sum, route) => sum + number(route.estimatedCo2), 0),
      latestEndMinutes: routes.length ? Math.max(...routes.map((route) => number(route.returnMinutes))) : 0,
      utilizationScore: totalCapacity ? totalVolume / totalCapacity * 100 : 0,
      overtimeMinutes: 0,
      serviceRate: scenario.orders?.length ? assignedIds.length / scenario.orders.length * 100 : 0,
    };
    const authority = {
      version: VERSION,
      basePlanHash: text(basePlan.planHash),
      derivedInputHash: text(scenario.inputHash),
      recoveryRequestHash: text(metadata.request.recoveryRequestHash),
      objective: metadata.request.objective,
      routes: routes.map((route) => ({ routeId: route.routeId, vehicleId: route.vehicleId, orderIds: route.orderIds, historicalOnly: route.historicalOnly === true })),
      unassignedOrderIds,
      recoveryRevision: number(metadata.recoveryRevision, 1),
    };
    const planHash = Incidents.hashValue(authority);
    return {
      planId: `REC-${metadata.request.objective}-${planHash.split(":").at(-1).slice(0, 10).toUpperCase()}`,
      planHash,
      inputHash: text(scenario.inputHash),
      basePlanHash: text(basePlan.planHash),
      parentPlanHash: text(basePlan.planHash),
      incidentHash: text(metadata.request.incidentHash),
      recoveryRequestHash: text(metadata.request.recoveryRequestHash),
      recoveryRevision: number(metadata.recoveryRevision, 1),
      manualRevision: number(basePlan.manualRevision),
      objective: metadata.request.objective,
      routes,
      routeGeoJson: { type: "FeatureCollection", features: routeFeatures },
      stopGeoJson: { type: "FeatureCollection", features: stopFeatures },
      unassignedOrderIds,
      blockedOrderIds: [],
      unassignedOrders: unassignedOrderIds.map((id) => ({ ...clone(orderMap.get(id) || {}), id, reasonCode: unassignedRows.find((row) => text(row.orderId) === id)?.reasonCode || "RECOVERY_UNASSIGNED" })),
      blockedOrders: [],
      metrics,
      verification: { status: "PENDING", recomputedMetrics: clone(metrics) },
      meta: {
        version: VERSION,
        method: metadata.method,
        engine: clone(metadata.request.engine),
        matrixProvider: clone(metadata.matrixContext?.provenance || metadata.request.matrixProvider),
        objectiveWeights: metadata.request.objective === "BALANCED_RECOVERY" ? clone(BALANCED_WEIGHTS) : null,
        insertionDecisions: clone(metadata.insertionDecisions || []),
        routeViolations: routeResults.flatMap((result) => result.violations || []),
        ruinedOrderIds: clone(metadata.ruinedOrderIds || []),
      },
    };
  }

  function changePenalty(basePlan, candidatePlan) {
    const before = Impact.assignmentIndex(basePlan);
    const after = Impact.assignmentIndex(candidatePlan);
    const ids = [...new Set([...before.keys(), ...after.keys()])].sort(compare);
    const movedOrders = [];
    const changedVehicles = new Set();
    const changedRoutes = new Set();
    const resequencedStops = [];
    ids.forEach((id) => {
      const a = before.get(id);
      const b = after.get(id);
      if (!a || !b || a.routeId !== b.routeId || a.vehicleId !== b.vehicleId) {
        movedOrders.push(id);
        if (a?.vehicleId) changedVehicles.add(a.vehicleId);
        if (b?.vehicleId) changedVehicles.add(b.vehicleId);
        if (a?.routeId) changedRoutes.add(a.routeId);
        if (b?.routeId) changedRoutes.add(b.routeId);
      } else if (a.sequence !== b.sequence) {
        resequencedStops.push(id);
        changedRoutes.add(a.routeId);
      }
    });
    const beforeStops = new Map([...Impact.stopRows(basePlan).values()].flat().map((stop) => [stop.orderId, stop]));
    const afterStops = new Map([...Impact.stopRows(candidatePlan).values()].flat().map((stop) => [stop.orderId, stop]));
    const etaShifts = ids.filter((id) => beforeStops.has(id) && afterStops.has(id)).map((id) => ({ orderId: id, minutes: number(afterStops.get(id).serviceStartMinute) - number(beforeStops.get(id).serviceStartMinute) }));
    const prefixChanges = [...changedRoutes].filter((routeId) => {
      const a = (basePlan.routes || []).find((route) => text(route.routeId) === routeId);
      const b = (candidatePlan.routes || []).find((route) => text(route.routeId) === routeId);
      return JSON.stringify(Impact.routeOrderIds(a, basePlan).slice(0, 2)) !== JSON.stringify(Impact.routeOrderIds(b, candidatePlan).slice(0, 2));
    });
    return {
      movedOrders: movedOrders.length,
      movedOrderIds: movedOrders,
      changedVehicles: changedVehicles.size,
      changedVehicleIds: [...changedVehicles].sort(compare),
      changedRoutes: changedRoutes.size,
      changedRouteIds: [...changedRoutes].sort(compare),
      resequencedStops: resequencedStops.length,
      resequencedStopIds: resequencedStops,
      changedRoutePrefixes: prefixChanges.length,
      changedRoutePrefixIds: prefixChanges,
      etaShiftTotal: etaShifts.reduce((sum, row) => sum + Math.abs(row.minutes), 0),
      etaShiftMax: etaShifts.length ? Math.max(...etaShifts.map((row) => Math.abs(row.minutes))) : 0,
      etaShifts,
    };
  }

  async function verifyRecoveryCandidate(candidate, context = {}) {
    const violations = [];
    const derivedIds = new Set((context.derivedScenario?.orders || []).map(orderId));
    const assigned = candidate.routes.flatMap((route) => route.orderIds);
    const all = [...assigned, ...(candidate.unassignedOrderIds || []), ...(candidate.blockedOrderIds || [])];
    const counts = new Map();
    all.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
    derivedIds.forEach((id) => { if (counts.get(id) !== 1) violations.push({ code: "RECOVERY_ORDER_CONSERVATION_FAILED", orderId: id, count: counts.get(id) || 0 }); });
    counts.forEach((count, id) => {
      if (!derivedIds.has(id)) violations.push({ code: "RECOVERY_UNKNOWN_ORDER", orderId: id });
      if (count > 1) violations.push({ code: "RECOVERY_DUPLICATE_ORDER", orderId: id, count });
    });
    violations.push(...(candidate.meta?.routeViolations || []));
    const pinning = Impact.verifyCandidatePinning(context.basePlan, candidate, context.pinning);
    violations.push(...pinning.violations);
    if (candidate.basePlanHash !== context.basePlan.planHash) violations.push({ code: "RECOVERY_BASE_PLAN_HASH_MISMATCH" });
    if (candidate.inputHash !== context.derivedScenario.inputHash) violations.push({ code: "RECOVERY_INPUT_HASH_MISMATCH" });
    let external = null;
    if (typeof context.verifier === "function") {
      external = await context.verifier(clone(candidate), clone(context.derivedScenario), { pinning: clone(context.pinning), incidentHash: candidate.incidentHash });
      if (external?.status !== "PASS") violations.push({ code: "UNIFIED_VERIFIER_REJECTED", detail: clone(external) });
    }
    const status = violations.length ? "FAIL" : "PASS";
    return {
      status,
      hardViolationCount: violations.length,
      hardViolations: violations,
      pinning,
      externalVerifier: clone(external),
      recomputedMetrics: clone(external?.recomputedMetrics || candidate.metrics),
      source: "STCT_RECOVERY_VERIFIER_V15",
    };
  }

  function carryForwardReference(basePlan, request) {
    return {
      ...clone(basePlan),
      planId: `REFERENCE-${text(basePlan.planId || "BASE")}`,
      referenceOnly: true,
      applyAllowed: false,
      objective: request.objective,
      basePlanHash: basePlan.planHash,
      incidentHash: request.incidentHash,
      recoveryRequestHash: request.recoveryRequestHash,
      verification: { status: "REFERENCE_NOT_VERIFIED", hardViolations: [], recomputedMetrics: clone(basePlan.verification?.recomputedMetrics || basePlan.metrics || {}) },
      meta: { ...(basePlan.meta || {}), method: "CARRY_FORWARD_REFERENCE", claimBoundary: "Reference plan only; feasibility under the incident is not asserted." },
    };
  }

  function labelCandidates(candidates) {
    const pass = candidates.filter((candidate) => candidate.verification?.status === "PASS");
    if (!pass.length) return candidates;
    const maxPriority = Math.max(...pass.map((candidate) => number(candidate.verification.recomputedMetrics.servicePriorityScore)));
    const maxAssigned = Math.max(...pass.filter((candidate) => number(candidate.verification.recomputedMetrics.servicePriorityScore) === maxPriority).map((candidate) => number(candidate.verification.recomputedMetrics.assigned)));
    const tier = pass.filter((candidate) => number(candidate.verification.recomputedMetrics.servicePriorityScore) === maxPriority && number(candidate.verification.recomputedMetrics.assigned) === maxAssigned);
    const best = {
      MINIMUM_CHANGE: Math.min(...tier.map((candidate) => candidate.changePenalty.movedOrders + candidate.changePenalty.resequencedStops)),
      BEST_SERVICE: maxPriority,
      LEAST_DELAY: Math.min(...tier.map((candidate) => number(candidate.verification.recomputedMetrics.latestEndMinutes))),
      LOWEST_COST: Math.min(...tier.map((candidate) => number(candidate.verification.recomputedMetrics.totalCost))),
      BALANCED_RECOVERY: Math.min(...tier.map((candidate) => number(candidate.recoveryScore))),
    };
    candidates.forEach((candidate) => {
      const labels = [];
      if (tier.includes(candidate)) {
        if (candidate.changePenalty.movedOrders + candidate.changePenalty.resequencedStops === best.MINIMUM_CHANGE) labels.push("MINIMUM_CHANGE");
        if (number(candidate.verification.recomputedMetrics.servicePriorityScore) === best.BEST_SERVICE) labels.push("BEST_SERVICE");
        if (number(candidate.verification.recomputedMetrics.latestEndMinutes) === best.LEAST_DELAY) labels.push("LEAST_DELAY");
        if (number(candidate.verification.recomputedMetrics.totalCost) === best.LOWEST_COST) labels.push("LOWEST_COST");
        if (number(candidate.recoveryScore) === best.BALANCED_RECOVERY) labels.push("BALANCED_RECOVERY");
      }
      candidate.labels = labels;
      candidate.serviceTier = { servicePriorityScore: maxPriority, assigned: maxAssigned, eligible: tier.includes(candidate) };
    });
    return candidates;
  }

  async function generateRecoveryCandidates(options = {}) {
    const basePlan = clone(options.basePlan || {});
    const baseScenario = clone(options.baseScenario || {});
    const derivedScenario = clone(options.derivedScenario || {});
    const incidentRows = clone(options.incidents || []);
    const pinning = clone(options.pinning || {});
    const blastRadius = clone(options.blastRadius || Impact.computeBlastRadius({ basePlan, baseScenario, derivedScenario, incidents: incidentRows, pinning }));
    const eventStore = options.eventStore || null;
    const provider = options.matrixContext ? null : (options.matrixProvider?.matrix ? options.matrixProvider : Matrices.createHaversineProvider({
      roadDistanceFactor: number(derivedScenario.assumptionsSnapshot?.roadDistanceFactor ?? derivedScenario.assumptions?.roadDistanceFactor, 1.35),
      averageSpeedKph: number(derivedScenario.assumptionsSnapshot?.averageSpeedKmh ?? derivedScenario.assumptions?.averageSpeedKmh, 28),
      version: "1.5.1",
    }));
    const matrixContext = options.matrixContext || await Matrices.createMatrixContext(provider, derivedScenario, options.matrixOptions);
    const matrixProvider = {
      id: matrixContext.provenance.providerId,
      version: matrixContext.provenance.providerVersion,
      providerId: matrixContext.provenance.providerId,
      providerVersion: matrixContext.provenance.providerVersion,
      matrixHash: matrixContext.provenance.matrixHash,
      profile: matrixContext.provenance.profile,
      status: "VERIFIED",
    };
    const combinedIncidentHash = incidentRows.length === 1 ? incidentRows[0].incidentHash : Incidents.hashValue(incidentRows.map((incident) => incident.incidentHash));
    const objectives = options.objectives?.length ? options.objectives : OBJECTIVES;
    const candidates = [];
    const references = [];
    for (const objective of objectives) {
      if (options.isStale?.()) return { status: "STALE_RESPONSE", candidates: [], references: [], blastRadius, pinning };
      const request = createRecoveryRequest({
        basePlanHash: basePlan.planHash,
        derivedInputHash: derivedScenario.inputHash,
        incidentHash: combinedIncidentHash,
        objective,
        pinningSnapshot: pinning,
        engine: options.engine,
        matrixProvider,
        solveOptions: options.solveOptions,
      });
      eventStore?.append("RECOVERY_REQUESTED", {
        aggregateType: "RECOVERY_REQUEST",
        aggregateId: request.recoveryRequestHash,
        scenarioId: derivedScenario.scenarioId,
        inputHash: derivedScenario.inputHash,
        basePlanHash: basePlan.planHash,
        incidentHash: combinedIncidentHash,
        source: "recovery-v15",
        logicalTime: pinning.incidentMinute,
        payload: { objective, recoveryRequestHash: request.recoveryRequestHash, pinningHash: pinning.pinningHash },
      }, { dedupeKey: `recovery-requested:${request.recoveryRequestHash}` });
      references.push(carryForwardReference(basePlan, request));
      const seed = localRuinAndRecreateSeed(basePlan, blastRadius, pinning, derivedScenario);
      const baseOrderMap = new Map((baseScenario.orders || []).map((order) => [orderId(order), order]));
      const insertion = regretInsertion(seed.repairOrderIds, seed.routes, derivedScenario, { basePlan, baseOrderMap, pinning, objective, matrixContext });
      const unassigned = [...insertion.unassigned];
      const assignedSet = new Set(insertion.routes.flatMap((route) => route.orderIds));
      (derivedScenario.orders || []).forEach((order) => {
        const id = orderId(order);
        if (!assignedSet.has(id) && !unassigned.some((row) => row.orderId === id)) unassigned.push({ orderId: id, reasonCode: "NOT_ASSIGNED_AFTER_LOCAL_REPAIR" });
      });
      const candidate = materializePlan(insertion.routes, unassigned, derivedScenario, basePlan, {
        baseScenario,
        request,
        method: objective === "BALANCED_RECOVERY" ? "LOCAL_RUIN_AND_RECREATE" : "LOCAL_REGRET_INSERTION",
        recoveryRevision: 1,
        insertionDecisions: insertion.decisions,
        ruinedOrderIds: seed.ruinedOrderIds,
        matrixContext,
      });
      candidate.changePenalty = changePenalty(basePlan, candidate);
      candidate.metrics.changeCount = candidate.changePenalty.movedOrders + candidate.changePenalty.resequencedStops;
      candidate.recoveryScore = candidate.metrics.latestEndMinutes * BALANCED_WEIGHTS.delay / 60
        + candidate.metrics.totalCost * BALANCED_WEIGHTS.cost / 100
        + candidate.changePenalty.movedOrders * BALANCED_WEIGHTS.change
        + candidate.changePenalty.resequencedStops * BALANCED_WEIGHTS.change / 2
        - candidate.metrics.servicePriorityScore * BALANCED_WEIGHTS.service;
      eventStore?.append("RECOVERY_CANDIDATE_GENERATED", {
        aggregateType: "RECOVERY_PLAN",
        aggregateId: candidate.planHash,
        scenarioId: derivedScenario.scenarioId,
        inputHash: derivedScenario.inputHash,
        basePlanHash: basePlan.planHash,
        resultingPlanHash: candidate.planHash,
        incidentHash: combinedIncidentHash,
        source: "recovery-v15",
        logicalTime: pinning.incidentMinute,
        payload: { objective, recoveryRequestHash: request.recoveryRequestHash, method: candidate.meta.method },
      }, { dedupeKey: `recovery-generated:${candidate.planHash}` });
      candidate.verification = await verifyRecoveryCandidate(candidate, { basePlan, derivedScenario, pinning, verifier: options.verifier });
      candidate.applyAllowed = candidate.verification.status === "PASS";
      eventStore?.append("RECOVERY_CANDIDATE_VERIFIED", {
        aggregateType: "RECOVERY_PLAN",
        aggregateId: candidate.planHash,
        scenarioId: derivedScenario.scenarioId,
        inputHash: derivedScenario.inputHash,
        basePlanHash: basePlan.planHash,
        resultingPlanHash: candidate.planHash,
        incidentHash: combinedIncidentHash,
        source: "recovery-v15",
        logicalTime: pinning.incidentMinute,
        payload: { objective, status: candidate.verification.status, hardViolationCount: candidate.verification.hardViolationCount },
      }, { dedupeKey: `recovery-verified:${candidate.planHash}:${candidate.verification.status}` });
      candidates.push(candidate);
    }
    labelCandidates(candidates);
    return { status: "PASS", candidates, references, blastRadius, pinning, combinedIncidentHash, matrixProvenance: clone(matrixContext.provenance) };
  }

  async function fullReoptimization(options = {}) {
    const integrated = options.integrationStatus === "INTEGRATED_OR_TOOLS" && text(options.engineProvenance?.id) === "OR_TOOLS" && typeof options.solve === "function";
    if (!integrated) return { status: "NOT_INTEGRATED", integrationStatus: "ADAPTER_ONLY", engineTruth: "NOT_INTEGRATED", capabilityLimit: "FULL_REOPTIMIZATION_ADAPTER_NOT_INTEGRATED", networkCalled: false };
    const capability = options.engineCapabilities?.pinning === true;
    const candidate = await options.solve(clone(options.request), { pinning: clone(options.pinning) });
    const verification = await verifyRecoveryCandidate(candidate, options);
    return {
      status: verification.status,
      candidate: clone(candidate),
      verification,
      capabilityLimit: capability ? null : "ENGINE_PINNING_NOT_NATIVE_POST_VERIFY_ENFORCED",
      postVerifyApplied: !capability,
      integrationStatus: "INTEGRATED_OR_TOOLS",
      engineTruth: "OR_TOOLS",
    };
  }

  function createRecoveryController(options = {}) {
    const basePlan = clone(options.basePlan || {});
    const baseScenario = clone(options.baseScenario || {});
    const simulationStore = options.simulationStore;
    const eventStore = options.eventStore || DomainEvents.createEventStore({ clock: options.eventClock });
    const ownsEventStore = !options.eventStore;
    if (!text(basePlan.planHash) || !text(baseScenario.inputHash)) throw error("RECOVERY_BASE_REQUIRED", "Recovery controller requires base plan and scenario.");
    if (!simulationStore?.exportState || !simulationStore?.setActivePlan || !simulationStore?.restoreState) throw error("RECOVERY_SIMULATION_STORE_REQUIRED", "Recovery controller requires SimulationStore v1.5.");
    let generation = 0;
    let currentPlan = clone(basePlan);
    let latest = null;
    let applied = null;
    const history = [];
    let destroyed = false;

    function ensureActive() {
      if (destroyed) throw error("RECOVERY_CONTROLLER_DESTROYED", "Recovery controller has been destroyed.");
    }

    async function generate(input = {}) {
      ensureActive();
      const token = ++generation;
      const result = await generateRecoveryCandidates({
        ...input,
        basePlan,
        baseScenario,
        eventStore,
        isStale: () => destroyed || token !== generation,
      });
      if (destroyed || token !== generation || result.status === "STALE_RESPONSE") return { status: "STALE_RESPONSE", candidates: [] };
      latest = clone(result);
      return clone(result);
    }

    function cancelGeneration() {
      generation += 1;
      return { status: "CANCELLED", generation };
    }

    async function apply(candidate, applyOptions = {}) {
      ensureActive();
      if (applied) throw error("RECOVERY_ALREADY_APPLIED", "Undo the active recovery before applying another candidate.");
      if (candidate?.verification?.status !== "PASS" || candidate.applyAllowed !== true) throw error("RECOVERY_CANDIDATE_NOT_VERIFIED", "Only verifier-PASS recovery candidates can be applied.");
      if (candidate.basePlanHash !== basePlan.planHash || candidate.parentPlanHash !== basePlan.planHash) throw error("STALE_RECOVERY_RESPONSE", "Recovery candidate does not belong to the active base plan.");
      if (!latest?.candidates?.some((row) => row.planHash === candidate.planHash && row.recoveryRequestHash === candidate.recoveryRequestHash)) throw error("STALE_RECOVERY_RESPONSE", "Recovery candidate is not part of the latest generation.");
      const saved = {
        plan: clone(currentPlan),
        simulation: simulationStore.exportState(),
        simulationPolicy: text(applyOptions.simulationPolicy || "RESET"),
        selection: clone(options.getSelection?.() || {}),
      };
      const simulationResult = await simulationStore.setActivePlan(candidate, saved.simulationPolicy, { source: "recovery-apply" });
      currentPlan = clone(candidate);
      applied = { candidate: clone(candidate), saved, simulationResult: clone(simulationResult) };
      history.push({ action: "APPLY", basePlanHash: basePlan.planHash, incidentHash: candidate.incidentHash, recoveryRequestHash: candidate.recoveryRequestHash, recoveryPlanHash: candidate.planHash, parentPlanHash: candidate.parentPlanHash, recoveryRevision: candidate.recoveryRevision, simulationPolicy: saved.simulationPolicy, beforeSimulationHash: saved.simulation.simulationHash, afterSimulationHash: simulationResult.snapshot.simulationHash });
      eventStore.append("RECOVERY_PLAN_APPLIED", {
        aggregateType: "RECOVERY_PLAN",
        aggregateId: candidate.planHash,
        scenarioId: text(options.derivedScenario?.scenarioId),
        inputHash: candidate.inputHash,
        basePlanHash: basePlan.planHash,
        resultingPlanHash: candidate.planHash,
        simulationHash: simulationResult.snapshot.simulationHash,
        incidentHash: candidate.incidentHash,
        source: "recovery-controller-v15",
        logicalTime: options.pinning?.incidentMinute ?? 0,
        payload: { recoveryRequestHash: candidate.recoveryRequestHash, parentPlanHash: candidate.parentPlanHash, recoveryRevision: candidate.recoveryRevision, simulationPolicy: saved.simulationPolicy },
      }, { dedupeKey: `recovery-applied:${candidate.planHash}:${history.length}` });
      options.setSelection?.({ planHash: candidate.planHash, vehicleId: applyOptions.vehicleId || saved.selection.vehicleId, orderId: applyOptions.orderId || saved.selection.orderId });
      return { status: "APPLIED", plan: clone(currentPlan), simulation: clone(simulationResult.snapshot), lineage: clone(history.at(-1)) };
    }

    async function undo() {
      ensureActive();
      if (!applied) return { status: "NO_ACTIVE_RECOVERY", plan: clone(currentPlan) };
      const active = applied;
      const restored = await simulationStore.restoreState(active.saved.simulation, { source: "recovery-undo" });
      currentPlan = clone(active.saved.plan);
      options.setSelection?.(clone(active.saved.selection));
      const row = { action: "UNDO", recoveryPlanHash: active.candidate.planHash, restoredPlanHash: currentPlan.planHash, restoredSimulationHash: restored.snapshot.simulationHash, expectedSimulationHash: active.saved.simulation.simulationHash, simulationPolicy: active.saved.simulationPolicy };
      history.push(row);
      eventStore.append("RECOVERY_UNDO", {
        aggregateType: "RECOVERY_PLAN",
        aggregateId: active.candidate.planHash,
        scenarioId: text(options.derivedScenario?.scenarioId),
        inputHash: active.candidate.inputHash,
        basePlanHash: basePlan.planHash,
        resultingPlanHash: currentPlan.planHash,
        simulationHash: restored.snapshot.simulationHash,
        incidentHash: active.candidate.incidentHash,
        source: "recovery-controller-v15",
        logicalTime: options.pinning?.incidentMinute ?? 0,
        payload: { recoveryRequestHash: active.candidate.recoveryRequestHash, restoredPlanHash: currentPlan.planHash, simulationPolicy: active.saved.simulationPolicy },
      }, { dedupeKey: `recovery-undo:${active.candidate.planHash}:${history.length}` });
      applied = null;
      if (restored.snapshot.simulationHash !== active.saved.simulation.simulationHash) throw error("RECOVERY_UNDO_HASH_DRIFT", "Recovery undo did not restore the original simulation hash.");
      return { status: "UNDONE", plan: clone(currentPlan), simulation: clone(restored.snapshot), lineage: clone(row) };
    }

    async function restoreBaseline() {
      ensureActive();
      if (applied) await undo();
      currentPlan = clone(basePlan);
      return { status: "BASELINE_RESTORED", plan: clone(currentPlan) };
    }

    function exportAudit() {
      ensureActive();
      return {
        version: VERSION,
        baseInputHash: baseScenario.inputHash,
        basePlanHash: basePlan.planHash,
        currentPlanHash: currentPlan.planHash,
        incidentHashes: clone(latest?.combinedIncidentHash ? [latest.combinedIncidentHash] : []),
        pinning: clone(latest?.pinning || options.pinning || null),
        blastRadius: clone(latest?.blastRadius || null),
        candidates: clone((latest?.candidates || []).map((candidate) => ({ planHash: candidate.planHash, recoveryRequestHash: candidate.recoveryRequestHash, incidentHash: candidate.incidentHash, parentPlanHash: candidate.parentPlanHash, recoveryRevision: candidate.recoveryRevision, objective: candidate.objective, method: candidate.meta?.method, verification: candidate.verification, changePenalty: candidate.changePenalty }))),
        lineage: clone(history),
        domainEventStreamHash: eventStore.eventStreamHash(),
      };
    }

    function snapshot() {
      ensureActive();
      return { version: VERSION, basePlanHash: basePlan.planHash, currentPlan: clone(currentPlan), latest: clone(latest), applied: clone(applied?.candidate || null), history: clone(history), generation };
    }

    function destroy() {
      if (destroyed) return;
      generation += 1;
      if (ownsEventStore) eventStore.destroy();
      destroyed = true;
    }

    return { get eventStore() { return eventStore; }, generate, cancelGeneration, apply, undo, restoreBaseline, exportAudit, snapshot, destroy };
  }

  return {
    VERSION,
    OBJECTIVES,
    METHODS,
    BALANCED_WEIGHTS,
    createRecoveryRequest,
    evaluateRoute,
    insertionOptions,
    regretInsertion,
    localRuinAndRecreateSeed,
    materializePlan,
    changePenalty,
    verifyRecoveryCandidate,
    carryForwardReference,
    labelCandidates,
    generateRecoveryCandidates,
    fullReoptimization,
    createRecoveryController,
  };
});
