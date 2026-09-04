(function (root, factory) {
  "use strict";
  const diff = root?.STCTV15?.canonicalDiff || (typeof require === "function" ? require("./canonical-diff-v15.js") : null);
  const api = factory(diff);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV15 = root.STCTV15 || { version: "1.5.0" };
    root.STCTV15.explainability = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (CanonicalDiff) {
  "use strict";

  if (!CanonicalDiff) throw new Error("Explainability v1.5 requires Canonical Diff v1.5.");

  const VERSION = "stct-explainability-v1.5";
  const SEVERITIES = Object.freeze(["HARD", "SOFT", "INFORMATIONAL"]);
  const STATUSES = Object.freeze(["SATISFIED", "VIOLATED", "ACTIVE", "INACTIVE"]);
  const CONFIDENCE = Object.freeze(["DETERMINISTIC", "COMPARATIVE", "HEURISTIC", "UNKNOWN"]);
  const REQUIRED_FIELDS = Object.freeze([
    "explanationId", "constraintCode", "category", "severity", "status", "entityType", "entityIds",
    "measuredValue", "limitValue", "delta", "unit", "evidence", "confidence", "suggestedActions", "source",
  ]);
  const DEFAULT_WEIGHTS = Object.freeze({
    usedVehicles: 20,
    estimatedRoadKm: 20,
    totalCost: 20,
    totalCO2: 15,
    latestEnd: 15,
    utilizationScore: 10,
  });
  const SCORE_DIMENSIONS = Object.freeze([
    { id: "servicePriorityScore", label: "Service Priority", direction: "max", weightKey: "servicePriorityScore", gate: true },
    { id: "assigned", label: "Assigned Count", direction: "max", weightKey: "assigned", gate: true },
    { id: "usedVehicles", label: "Vehicle Count", direction: "min", weightKey: "usedVehicles" },
    { id: "estimatedRoadKm", label: "Distance", direction: "min", weightKey: "estimatedRoadKm" },
    { id: "totalCost", label: "Cost", direction: "min", weightKey: "totalCost" },
    { id: "totalCO2", label: "CO2", direction: "min", weightKey: "totalCO2" },
    { id: "latestEndMinutes", label: "Latest End", direction: "min", weightKey: "latestEnd" },
    { id: "utilizationScore", label: "Utilization", direction: "max", weightKey: "utilizationScore" },
    { id: "overtimeMinutes", label: "Overtime", direction: "min", weightKey: "overtimeMinutes" },
    { id: "changePenalty", label: "Change Penalty", direction: "min", weightKey: "changePenalty" },
    { id: "softViolationCount", label: "Soft Violations", direction: "min", weightKey: "softViolationCount" },
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
    return text(left).localeCompare(text(right), "en");
  }

  function fnv1a(value) {
    let hash = 0x811c9dc5;
    new TextEncoder().encode(String(value)).forEach((byte) => {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    });
    return hash.toString(16).padStart(8, "0");
  }

  function minutes(value, fallback = 0) {
    if (Number.isFinite(Number(value))) return Number(value);
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : fallback;
  }

  function explanation(specification = {}) {
    const semantic = {
      constraintCode: text(specification.constraintCode),
      category: text(specification.category),
      severity: text(specification.severity || "INFORMATIONAL").toUpperCase(),
      status: text(specification.status || "ACTIVE").toUpperCase(),
      entityType: text(specification.entityType || "SCENARIO").toUpperCase(),
      entityIds: [...new Set((specification.entityIds || []).map(text).filter(Boolean))].sort(compare),
      measuredValue: specification.measuredValue ?? null,
      limitValue: specification.limitValue ?? null,
      delta: specification.delta ?? null,
      unit: text(specification.unit),
      evidence: clone(specification.evidence || []),
      confidence: text(specification.confidence || "UNKNOWN").toUpperCase(),
      suggestedActions: clone(specification.suggestedActions || []),
      source: text(specification.source || "stct-v15"),
    };
    return { explanationId: text(specification.explanationId || `EXP-${fnv1a(CanonicalDiff.stableStringify(semantic))}`), ...semantic };
  }

  function validateExplanation(value) {
    const errors = [];
    if (!value || typeof value !== "object" || Array.isArray(value)) errors.push("EXPLANATION_NOT_OBJECT");
    else {
      REQUIRED_FIELDS.forEach((field) => { if (!Object.hasOwn(value, field)) errors.push(`MISSING_${field.toUpperCase()}`); });
      if (!text(value.explanationId)) errors.push("EXPLANATION_ID_REQUIRED");
      if (!text(value.constraintCode)) errors.push("CONSTRAINT_CODE_REQUIRED");
      if (!text(value.category)) errors.push("CATEGORY_REQUIRED");
      if (!SEVERITIES.includes(value.severity)) errors.push("SEVERITY_INVALID");
      if (!STATUSES.includes(value.status)) errors.push("STATUS_INVALID");
      if (!text(value.entityType)) errors.push("ENTITY_TYPE_REQUIRED");
      if (!Array.isArray(value.entityIds)) errors.push("ENTITY_IDS_INVALID");
      if (!Array.isArray(value.evidence) || !value.evidence.length) errors.push("EVIDENCE_REQUIRED");
      if (!CONFIDENCE.includes(value.confidence)) errors.push("CONFIDENCE_INVALID");
      if (!Array.isArray(value.suggestedActions)) errors.push("SUGGESTED_ACTIONS_INVALID");
      if (!text(value.source)) errors.push("SOURCE_REQUIRED");
    }
    return { status: errors.length ? "FAIL" : "PASS", errors };
  }

  function verifiedMetrics(plan) {
    if (plan?.verification?.status !== "PASS" || !plan.verification.recomputedMetrics) {
      const error = new Error("Explanation requires verifier PASS and recomputed metrics.");
      error.code = "UNVERIFIED_EXPLANATION_SOURCE";
      throw error;
    }
    return clone(plan.verification.recomputedMetrics);
  }

  function routeOrderIds(route, plan) {
    if (Array.isArray(route?.orderIds)) return route.orderIds.map(text).filter(Boolean);
    return (plan?.stopGeoJson?.features || []).filter((feature) => text(feature.properties?.routeId) === text(route?.routeId))
      .sort((a, b) => number(a.properties?.seq) - number(b.properties?.seq)).map((feature) => text(feature.properties?.orderId)).filter(Boolean);
  }

  function assignmentIndex(plan) {
    const result = new Map();
    (plan?.routes || []).forEach((route) => routeOrderIds(route, plan).forEach((orderId, index) => result.set(orderId, {
      orderId,
      routeId: text(route.routeId),
      vehicleId: text(route.vehicleId),
      sequence: index + 1,
    })));
    return result;
  }

  function orderById(scenario, orderId) {
    return (scenario?.orders || []).find((order) => text(order.id || order.orderId || order.code) === text(orderId)) || null;
  }

  function vehicleById(scenario, vehicleId) {
    return (scenario?.vehicles || []).find((vehicle) => text(vehicle.id || vehicle.vehicleId) === text(vehicleId)) || null;
  }

  function stopByOrder(plan, orderId) {
    return (plan?.stopGeoJson?.features || []).find((feature) => text(feature.properties?.orderId) === text(orderId))?.properties || null;
  }

  function capacityExplanation(order, vehicles, kind = "volume") {
    const field = kind === "weight" ? "weight" : "volume";
    const capacityField = kind === "weight" ? "maxWeight" : "maxVolume";
    const measured = number(order?.[field]);
    const limit = Math.max(0, ...(vehicles || []).map((vehicle) => number(vehicle?.[capacityField])));
    return explanation({
      constraintCode: measured > limit ? `ORDER_EXCEEDS_ALL_VEHICLES_${field.toUpperCase()}` : `ORDER_${field.toUpperCase()}_COMPATIBLE`,
      category: "CAPACITY",
      severity: measured > limit ? "HARD" : "INFORMATIONAL",
      status: measured > limit ? "VIOLATED" : "SATISFIED",
      entityType: "ORDER",
      entityIds: [text(order?.id || order?.orderId || order?.code)],
      measuredValue: measured,
      limitValue: limit,
      delta: measured - limit,
      unit: field,
      evidence: [{ source: "CANONICAL_SCENARIO", field, value: measured }, { source: "CANONICAL_VEHICLES", field: capacityField, maximum: limit }],
      confidence: "DETERMINISTIC",
      suggestedActions: measured > limit ? ["Split order", `Add a vehicle with sufficient ${field} capacity`] : [],
      source: "canonical-local-feasibility-check",
    });
  }

  function timeWindowExplanation(order, arrivalMinutes) {
    const windowEnd = minutes(order?.twEnd, Infinity);
    const measured = number(arrivalMinutes);
    const violated = measured > windowEnd;
    return explanation({
      constraintCode: violated ? "TIME_WINDOW_END_EXCEEDED" : "TIME_WINDOW_SATISFIED",
      category: "TIME_WINDOW",
      severity: violated ? "HARD" : "INFORMATIONAL",
      status: violated ? "VIOLATED" : "SATISFIED",
      entityType: "ORDER",
      entityIds: [text(order?.id || order?.orderId || order?.code)],
      measuredValue: measured,
      limitValue: windowEnd,
      delta: measured - windowEnd,
      unit: "minute",
      evidence: [{ source: "CANONICAL_ORDER", twStart: order?.twStart, twEnd: order?.twEnd }, { source: "VERIFIER_RECOMPUTED_ROUTE", arrivalMinutes: measured }],
      confidence: "DETERMINISTIC",
      suggestedActions: violated ? ["Move the stop earlier", "Use another compatible route"] : [],
      source: "verifier-time-window-check",
    });
  }

  function noVehicleExplanation(order, vehicles, gaps = []) {
    return explanation({
      constraintCode: "NO_COMPATIBLE_VEHICLE",
      category: "VEHICLE_COMPATIBILITY",
      severity: "HARD",
      status: "VIOLATED",
      entityType: "ORDER",
      entityIds: [text(order?.id || order?.orderId || order?.code)],
      measuredValue: gaps.length,
      limitValue: 0,
      delta: gaps.length,
      unit: "capability-gap",
      evidence: [{ source: "CANONICAL_VEHICLES", vehicleCount: vehicles?.length || 0, capabilityGaps: clone(gaps) }],
      confidence: "DETERMINISTIC",
      suggestedActions: ["Add or enable a compatible vehicle", "Adjust the blocking requirement"],
      source: "canonical-vehicle-capability-check",
    });
  }

  function whyAssigned(orderId, plan, scenario, candidatePool = []) {
    const metrics = verifiedMetrics(plan);
    const assignment = assignmentIndex(plan).get(text(orderId));
    if (!assignment) {
      const error = new Error(`Order is not assigned in this plan: ${orderId}`);
      error.code = "ORDER_NOT_ASSIGNED";
      throw error;
    }
    const order = orderById(scenario, orderId);
    const vehicle = vehicleById(scenario, assignment.vehicleId);
    if (!order || !vehicle) throw Object.assign(new Error("Assigned order or vehicle is absent from the canonical scenario."), { code: "CANONICAL_ENTITY_MISSING" });
    const route = (plan.routes || []).find((row) => text(row.routeId) === assignment.routeId);
    const routeOrders = routeOrderIds(route, plan).map((id) => orderById(scenario, id)).filter(Boolean);
    const routeVolume = routeOrders.reduce((sum, row) => sum + number(row.volume), 0);
    const routeWeight = routeOrders.reduce((sum, row) => sum + number(row.weight), 0);
    const stop = stopByOrder(plan, orderId) || {};
    const arrival = number(stop.rawArrivalMinutes ?? stop.serviceStartMinutes, minutes(order.twStart));
    const averageSpeed = number(scenario?.assumptionsSnapshot?.averageSpeedKmh ?? scenario?.assumptions?.averageSpeedKmh, 28);
    const incrementalDistanceKm = number(stop.travelMin) * averageSpeed / 60;
    const incrementalCost = incrementalDistanceKm * number(vehicle.perKmCost) + number(vehicle.perStopCost) + number(stop.travelMin) * number(vehicle.perMinuteCost);
    const alternativeRoutes = (plan.routes || []).filter((candidate) => text(candidate.routeId) !== assignment.routeId).filter((candidate) => {
      const candidateVehicle = vehicleById(scenario, candidate.vehicleId);
      if (!candidateVehicle) return false;
      const assignedOrders = routeOrderIds(candidate, plan).map((id) => orderById(scenario, id)).filter(Boolean);
      return assignedOrders.reduce((sum, row) => sum + number(row.volume), 0) + number(order.volume) <= number(candidateVehicle.maxVolume)
        && assignedOrders.reduce((sum, row) => sum + number(row.weight), 0) + number(order.weight) <= number(candidateVehicle.maxWeight);
    });
    return {
      version: VERSION,
      question: "WHY_ASSIGNED",
      orderId: text(orderId),
      routeId: assignment.routeId,
      vehicleId: assignment.vehicleId,
      evidenceAuthority: ["CANONICAL_SCENARIO", "CANONICAL_PLAN_ASSIGNMENT", "VERIFIER_RECOMPUTED_METRICS", "LOCAL_FEASIBILITY_CHECK"],
      recomputedPlanMetrics: metrics,
      facts: {
        vehicleCompatible: number(order.volume) <= number(vehicle.maxVolume) && number(order.weight) <= number(vehicle.maxWeight),
        remainingVolume: number(vehicle.maxVolume) - routeVolume,
        remainingWeight: number(vehicle.maxWeight) - routeWeight,
        arrivalMinutes: arrival,
        timeWindowStart: minutes(order.twStart),
        timeWindowEnd: minutes(order.twEnd, Infinity),
        incrementalDistanceKm,
        incrementalCost,
        priorityWeight: number(order.priorityWeight, 1),
        alternativeFeasibleRouteIds: alternativeRoutes.map((candidate) => text(candidate.routeId)).sort(compare),
      },
      explanations: [
        capacityExplanation(order, [vehicle], "volume"),
        capacityExplanation(order, [vehicle], "weight"),
        timeWindowExplanation(order, arrival),
      ],
      confidence: alternativeRoutes.length ? "COMPARATIVE" : "HEURISTIC",
      claimBoundary: "This is an observed verified assignment with local feasibility evidence; global uniqueness or optimality is not proven.",
      candidatePoolPlanCount: candidatePool.filter((candidate) => candidate?.verification?.status === "PASS").length,
    };
  }

  function whyUnassigned(orderId, plan, scenario, candidatePool = []) {
    verifiedMetrics(plan);
    const order = orderById(scenario, orderId);
    if (!order) return { question: "WHY_UNASSIGNED", orderId: text(orderId), classification: "INPUT_DATA_BLOCK", confidence: "DETERMINISTIC", explanations: [explanation({ constraintCode: "ORDER_NOT_IN_CANONICAL_SCENARIO", category: "INPUT", severity: "HARD", status: "VIOLATED", entityType: "ORDER", entityIds: [orderId], evidence: [{ source: "CANONICAL_SCENARIO", orderFound: false }], confidence: "DETERMINISTIC", suggestedActions: ["Repair order identity"], source: "canonical-input-check" })] };
    const vehicles = (scenario.vehicles || []).filter((vehicle) => vehicle.enabled !== false);
    const volume = capacityExplanation(order, vehicles, "volume");
    const weight = capacityExplanation(order, vehicles, "weight");
    if (!vehicles.length) return { question: "WHY_UNASSIGNED", orderId: text(orderId), classification: "ORDER_INFEASIBLE", confidence: "DETERMINISTIC", explanations: [noVehicleExplanation(order, vehicles, ["NO_ENABLED_VEHICLE"])] };
    if (volume.status === "VIOLATED" || weight.status === "VIOLATED") return { question: "WHY_UNASSIGNED", orderId: text(orderId), classification: "ORDER_INFEASIBLE", confidence: "DETERMINISTIC", explanations: [volume, weight].filter((row) => row.status === "VIOLATED") };
    const totalVolume = (scenario.orders || []).reduce((sum, row) => sum + number(row.volume), 0);
    const totalCapacity = vehicles.reduce((sum, vehicle) => sum + number(vehicle.maxVolume), 0);
    if (totalVolume > totalCapacity) {
      return {
        question: "WHY_UNASSIGNED",
        orderId: text(orderId),
        classification: "SCENARIO_CAPACITY_PRESSURE",
        confidence: "COMPARATIVE",
        explanations: [explanation({ constraintCode: "FLEET_VOLUME_PRESSURE", category: "SCENARIO_CAPACITY", severity: "HARD", status: "ACTIVE", entityType: "SCENARIO", entityIds: [text(scenario.scenarioId || scenario.inputHash)], measuredValue: totalVolume, limitValue: totalCapacity, delta: totalVolume - totalCapacity, unit: "volume", evidence: [{ source: "CANONICAL_SCENARIO_AGGREGATE", totalVolume, totalCapacity }], confidence: "COMPARATIVE", suggestedActions: ["Add capacity", "Reduce or split demand"], source: "aggregate-capacity-check" })],
        claimBoundary: "Aggregate fleet pressure is evidence about the scenario, not a deterministic single-order cause.",
      };
    }
    const alternative = candidatePool.find((candidate) => candidate?.verification?.status === "PASS" && assignmentIndex(candidate).has(text(orderId)));
    if (alternative) return { question: "WHY_UNASSIGNED", orderId: text(orderId), classification: "ROUTE_COMBINATION_CONFLICT", confidence: "COMPARATIVE", comparisonPlanHash: alternative.planHash, explanations: [explanation({ constraintCode: "ASSIGNED_IN_PEER_CANDIDATE", category: "CANDIDATE_COMPARISON", severity: "INFORMATIONAL", status: "ACTIVE", entityType: "ORDER", entityIds: [orderId], evidence: [{ source: "CANDIDATE_POOL", comparisonPlanHash: alternative.planHash }], confidence: "COMPARATIVE", suggestedActions: ["Compare candidate route combinations"], source: "candidate-pool-comparison" })] };
    return { question: "WHY_UNASSIGNED", orderId: text(orderId), classification: "LIMITED_SEARCH_NOT_FOUND", confidence: "UNKNOWN", explanations: [explanation({ constraintCode: "NO_FEASIBLE_ASSIGNMENT_OBSERVED", category: "SOLVER_SEARCH", severity: "INFORMATIONAL", status: "ACTIVE", entityType: "ORDER", entityIds: [orderId], evidence: [{ source: "VERIFIED_PLAN", unassigned: true }, { source: "CANDIDATE_POOL", comparedPlans: candidatePool.length }], confidence: "UNKNOWN", suggestedActions: ["Increase search time", "Inspect route-combination constraints"], source: "bounded-search-observation" })], claimBoundary: "The bounded candidate pool does not prove global infeasibility." };
  }

  function metric(plan, id) {
    const metrics = verifiedMetrics(plan);
    if (id === "softViolationCount") return plan.verification.warnings?.length || 0;
    return number(metrics[id]);
  }

  function normalize(value, values, direction) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (!Number.isFinite(min) || !Number.isFinite(max) || Math.abs(max - min) < 0.000001) return 100;
    const ratio = direction === "min" ? (max - value) / (max - min) : (value - min) / (max - min);
    return Math.max(0, Math.min(100, ratio * 100));
  }

  function scoreWaterfall(plan, candidatePool = [], options = {}) {
    const targetMetrics = verifiedMetrics(plan);
    const pass = candidatePool.filter((candidate) => candidate?.verification?.status === "PASS" && text(candidate.inputHash) === text(plan.inputHash));
    const priority = number(targetMetrics.servicePriorityScore);
    const assigned = number(targetMetrics.assigned);
    const peers = pass.filter((candidate) => {
      const candidateMetrics = verifiedMetrics(candidate);
      return number(candidateMetrics.servicePriorityScore) === priority && number(candidateMetrics.assigned) === assigned;
    });
    if (!peers.some((candidate) => text(candidate.planHash) === text(plan.planHash))) peers.push(plan);
    const weights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };
    const totalWeight = Object.values(weights).reduce((sum, value) => sum + Math.max(0, number(value)), 0) || 1;
    const rows = SCORE_DIMENSIONS.map((definition) => {
      const rawValue = definition.id === "softViolationCount" ? plan.verification.warnings?.length || 0 : number(targetMetrics[definition.id]);
      const values = peers.map((candidate) => definition.id === "softViolationCount" ? candidate.verification.warnings?.length || 0 : number(verifiedMetrics(candidate)[definition.id]));
      const normalizedValue = normalize(rawValue, values, definition.direction);
      const weight = definition.gate ? 0 : Math.max(0, number(weights[definition.weightKey]));
      const contribution = normalizedValue * weight / totalWeight;
      return {
        id: definition.id,
        label: definition.label,
        rawValue,
        normalizedValue,
        weight,
        contribution,
        direction: definition.direction === "min" ? "LOWER_IS_BETTER" : "HIGHER_IS_BETTER",
        evidenceSource: definition.gate ? "VERIFIER_RECOMPUTED_SERVICE_GATE" : weight ? "VERIFIER_RECOMPUTED_METRICS + CANDIDATE_POOL_NORMALIZATION + EXPLICIT_WEIGHT" : "DISPLAYED_NOT_WEIGHTED_IN_CURRENT_POOL_SCORE",
      };
    });
    const displayedPoolScore = rows.reduce((sum, row) => sum + row.contribution, 0);
    return {
      version: VERSION,
      scoreType: "OBSERVED_CANDIDATE_POOL_SCORE",
      planHash: text(plan.planHash),
      inputHash: text(plan.inputHash),
      peerCount: peers.length,
      rows,
      displayedPoolScore,
      contributionTotal: displayedPoolScore,
      balancedSeed: {
        requested: (plan.requestedGoals || []).includes("balanced") || text(plan.meta?.goal || plan.meta?.requestedGoal) === "balanced",
        score: null,
        note: "Balanced Seed is an engine request/provenance label, not the observed candidate-pool score.",
      },
      evidenceAuthority: ["VERIFIER_RECOMPUTED_METRICS", "CANDIDATE_POOL_NORMALIZATION", "EXPLICIT_WEIGHTS"],
    };
  }

  function labelEvidence(plan, candidatePool) {
    const metrics = verifiedMetrics(plan);
    const pass = candidatePool.filter((candidate) => candidate?.verification?.status === "PASS" && text(candidate.inputHash) === text(plan.inputHash));
    const definitions = {
      distance: ["estimatedRoadKm", "min"],
      cost: ["totalCost", "min"],
      carbon: ["totalCO2", "min"],
      vehicles: ["usedVehicles", "min"],
      utilization: ["utilizationScore", "max"],
      balanced: ["balancedPoolScore", "max"],
    };
    return (plan.labels || []).map((label) => {
      const definition = definitions[label];
      if (!definition) return { label, evidence: "EXPLICIT_CANDIDATE_LABEL", provenAgainstObservedPool: false };
      const [field, direction] = definition;
      const values = pass.map((candidate) => field === "balancedPoolScore" ? scoreWaterfall(candidate, pass).displayedPoolScore : number(verifiedMetrics(candidate)[field]));
      const value = field === "balancedPoolScore" ? scoreWaterfall(plan, pass).displayedPoolScore : number(metrics[field]);
      const target = direction === "min" ? Math.min(...values) : Math.max(...values);
      return { label, field, direction, value, observedPoolTarget: target, provenAgainstObservedPool: Math.abs(value - target) < 0.000001, evidence: "VERIFIED_OBSERVED_CANDIDATE_POOL" };
    });
  }

  function whyThisPlan(plan, scenario, candidatePool = []) {
    const metrics = verifiedMetrics(plan);
    const waterfall = scoreWaterfall(plan, candidatePool);
    return {
      version: VERSION,
      question: "WHY_THIS_PLAN",
      planHash: text(plan.planHash),
      inputHash: text(plan.inputHash),
      metrics: {
        servicePriorityScore: number(metrics.servicePriorityScore),
        assigned: number(metrics.assigned),
        usedVehicles: number(metrics.usedVehicles),
        estimatedRoadKm: number(metrics.estimatedRoadKm),
        totalCost: number(metrics.totalCost),
        totalCO2: number(metrics.totalCO2),
        latestEndMinutes: number(metrics.latestEndMinutes),
        utilizationScore: number(metrics.utilizationScore),
        observedBalancedPoolScore: waterfall.displayedPoolScore,
      },
      labels: labelEvidence(plan, candidatePool),
      scoreWaterfall: waterfall,
      balancedSeed: waterfall.balancedSeed,
      evidenceAuthority: ["VERIFIER_RECOMPUTED_METRICS", "OBSERVED_CANDIDATE_POOL"],
      scenarioId: text(scenario?.scenarioId),
    };
  }

  function whyChanged(planA, planB, scenarioA = {}, scenarioB = scenarioA) {
    const left = assignmentIndex(planA);
    const right = assignmentIndex(planB);
    const ids = [...new Set([...left.keys(), ...right.keys(), ...(planA.unassignedOrderIds || []).map(text), ...(planB.unassignedOrderIds || []).map(text)])].sort(compare);
    const assignmentChanges = ids.map((orderId) => {
      const a = left.get(orderId) || null;
      const b = right.get(orderId) || null;
      let type = "UNCHANGED_ASSIGNMENT";
      if (!a && b) type = "NEWLY_ASSIGNED";
      else if (a && !b) type = "NEWLY_UNASSIGNED";
      else if (a && b && (a.routeId !== b.routeId || a.vehicleId !== b.vehicleId)) type = "REASSIGNED";
      else if (a && b && a.sequence !== b.sequence) type = "SEQUENCE_CHANGED";
      return { orderId, type, before: clone(a), after: clone(b) };
    }).filter((row) => row.type !== "UNCHANGED_ASSIGNMENT");
    const metricsA = verifiedMetrics(planA);
    const metricsB = verifiedMetrics(planB);
    const metricChanges = ["assigned", "usedVehicles", "estimatedRoadKm", "totalCost", "totalCO2", "latestEndMinutes", "utilizationScore"].map((id) => ({ id, before: number(metricsA[id]), after: number(metricsB[id]), delta: number(metricsB[id]) - number(metricsA[id]) }));
    return {
      version: VERSION,
      question: "WHY_CHANGED",
      planHashA: text(planA.planHash),
      planHashB: text(planB.planHash),
      assignmentChanges,
      metricChanges,
      canonicalFieldDiff: CanonicalDiff.scenarioDiff(scenarioA, scenarioB, { synthetic: scenarioA?.meta?.synthetic === true && scenarioB?.meta?.synthetic === true }),
      causeEvidence: clone(planB.meta?.manualAdjustmentAudit || planB.meta?.actions || []),
      claimBoundary: "Observed assignment, sequence, metric, and audit changes are reported; an unrecorded optimizer cause is not inferred.",
    };
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function exportJson(value) {
    return `${JSON.stringify(value, null, 2).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")}\n`;
  }

  function csvCell(value) {
    let source = typeof value === "string" ? value : JSON.stringify(value ?? "");
    if (/^[=+\-@]/.test(source)) source = `'${source}`;
    return `"${source.replace(/"/g, '""')}"`;
  }

  function exportCsv(rows) {
    const source = Array.isArray(rows) ? rows : [rows];
    const headers = [...new Set(source.flatMap((row) => Object.keys(row || {})))].sort(compare);
    return `${headers.map(csvCell).join(",")}\n${source.map((row) => headers.map((header) => csvCell(row?.[header])).join(",")).join("\n")}\n`;
  }

  function exportHtml(title, value) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre></body></html>`;
  }

  return {
    VERSION,
    SEVERITIES,
    STATUSES,
    CONFIDENCE,
    REQUIRED_FIELDS,
    DEFAULT_WEIGHTS,
    SCORE_DIMENSIONS,
    explanation,
    validateExplanation,
    capacityExplanation,
    timeWindowExplanation,
    noVehicleExplanation,
    whyAssigned,
    whyUnassigned,
    whyThisPlan,
    whyChanged,
    scoreWaterfall,
    verifiedMetrics,
    assignmentIndex,
    exportJson,
    exportCsv,
    exportHtml,
    escapeHtml,
  };
});
