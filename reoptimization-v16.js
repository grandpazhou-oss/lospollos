(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const rolling = root?.STCTV16?.rollingPlan || (typeof require === "function" ? require("./rolling-plan-v16.js") : null);
  const penalty = root?.STCTV16?.changePenalty || (typeof require === "function" ? require("./change-penalty-v16.js") : null);
  const jobs = root?.STCTV16?.jobs || (typeof require === "function" ? require("./job-lifecycle-v16.js") : null);
  const api = factory(integrity, rolling, penalty, jobs);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV16 = root.STCTV16 || { version: "1.6.0" }; root.STCTV16.reoptimization = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash, RollingPlan, ChangePenalty, JobLifecycle) {
  "use strict";
  if (!IntegrityHash?.hashValue || !RollingPlan || !ChangePenalty || !JobLifecycle) throw new Error("Reoptimization v1.6 dependencies are missing.");
  const VERSION = "stct-reoptimization-v1.6";
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  const number = (value, fallback = 0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
  function fail(code, message, detail = {}) { const error = new Error(message); error.code = code; error.detail = clone(detail); throw error; }

  function matrixContext(matrix) {
    if (!matrix?.matrixHash || !Array.isArray(matrix.sourceIds) || JSON.stringify(matrix.sourceIds) !== JSON.stringify(matrix.targetIds)) fail("ROLLING_MATRIX_INVALID", "A square authoritative road matrix is required.");
    const index = new Map(matrix.sourceIds.map((id, row) => [text(id), row]));
    function leg(fromId, toId) {
      const row = index.get(text(fromId)); const column = index.get(text(toId)); if (row === undefined || column === undefined) fail("ROLLING_MATRIX_POINT_MISSING", `Matrix has no point ${fromId} or ${toId}.`);
      const distance = matrix.distances[row][column]; const duration = matrix.durations[row][column]; if (distance === null || duration === null) return null;
      return { distance: matrix.distanceUnit === "km" ? distance : distance / 1000, duration: matrix.durationUnit === "minutes" ? duration : duration / 60 };
    }
    return { index, leg };
  }

  function activeVehicleByOrder(scenario) {
    return new Map((scenario.vehicles || []).filter((vehicle) => vehicle.activeStopId).map((vehicle) => [vehicle.activeStopId, vehicle.id]));
  }

  function localCandidate(kind, scenario, contextInput, matrix, options = {}) {
    const context = RollingPlan.normalizeContext(contextInput); const matrixApi = matrixContext(matrix); const orders = new Map(scenario.orders.map((order) => [text(order.id), order]));
    const activeVehicle = activeVehicleByOrder(scenario); const loadedVehicle = new Map(context.loadedOrderAssignments.map((row) => [row.orderId, row.vehicleId]));
    const prefixByVehicle = new Map(context.fixedRoutePrefixes.map((row) => [row.vehicleId, row]));
    const routes = scenario.vehicles.filter((vehicle) => vehicle.available !== false).map((vehicle, index) => ({ routeId: prefixByVehicle.get(vehicle.id)?.routeId || `ROLL-${String(index + 1).padStart(2, "0")}`, vehicleId: vehicle.id, startPointId: vehicle.startPointId, endPointId: vehicle.endPointId, orderIds: [], etaByOrder: {}, volume: 0, maxVolume: number(vehicle.maxVolume, Infinity), startMinute: number(vehicle.startMinute, context.cutoffLogicalMinute), currentPointId: vehicle.startPointId }));
    const routeByVehicle = new Map(routes.map((route) => [route.vehicleId, route]));
    const orderRows = [...orders.values()].sort((a, b) => {
      const activeRank = Number(activeVehicle.has(b.id)) - Number(activeVehicle.has(a.id));
      if (activeRank) return activeRank;
      if (kind === "LOCAL_RUIN_RECREATE") return number(b.volume) - number(a.volume) || text(a.id).localeCompare(text(b.id), "en");
      return number(b.priorityWeight, 1) - number(a.priorityWeight, 1) || text(a.id).localeCompare(text(b.id), "en");
    });
    const unassignedOrderIds = [];
    function append(route, order) {
      const leg = matrixApi.leg(route.currentPointId, order.id); if (!leg) return false;
      route.startMinute += leg.duration; route.etaByOrder[order.id] = route.startMinute; route.startMinute += number(order.serviceMin ?? order.serviceMinutes, 5); route.currentPointId = order.id; route.orderIds.push(order.id); route.volume += number(order.volume); return true;
    }
    for (const order of orderRows) {
      const fixedVehicleId = activeVehicle.get(order.id) || loadedVehicle.get(order.id) || text(order.fixedVehicleId); const candidateRoutes = fixedVehicleId ? [routeByVehicle.get(fixedVehicleId)].filter(Boolean) : routes;
      const feasible = candidateRoutes.filter((route) => route.volume + number(order.volume) <= route.maxVolume && matrixApi.leg(route.currentPointId, order.id)).sort((a, b) => {
        const aLeg = matrixApi.leg(a.currentPointId, order.id); const bLeg = matrixApi.leg(b.currentPointId, order.id); return aLeg.distance - bLeg.distance || a.vehicleId.localeCompare(b.vehicleId, "en");
      });
      if (!feasible.length || !append(feasible[0], order)) unassignedOrderIds.push(order.id);
    }
    const finalizedRoutes = routes.filter((route) => route.orderIds.length).map((route) => {
      const endLeg = matrixApi.leg(route.currentPointId, route.endPointId); return { ...route, returnMinute: endLeg ? route.startMinute + endLeg.duration : null, totalDistance: route.orderIds.reduce((sum, orderId, index) => { const previous = index ? route.orderIds[index - 1] : route.startPointId; return sum + (matrixApi.leg(previous, orderId)?.distance || 0); }, 0) + (endLeg?.distance || 0) };
    });
    const candidate = {
      schemaVersion: "stct-recovery-candidate-v1.6",
      candidateType: kind,
      reference: false,
      engine: kind === "LOCAL_REGRET_INSERTION" ? "Local Regret Insertion" : "Local Ruin-Recreate",
      engineVersion: VERSION,
      inputHash: scenario.inputHash,
      matrixHash: matrix.matrixHash,
      incidentHash: text(options.incidentHash),
      contextHash: context.contextHash,
      routes: finalizedRoutes,
      historicalPrefixes: clone(context.fixedRoutePrefixes),
      unassignedOrderIds,
      providerProvenance: clone(matrix.providerProvenance || context.providerProvenance),
      verification: null,
    };
    candidate.planHash = IntegrityHash.hashValue({ schemaVersion: candidate.schemaVersion, candidateType: candidate.candidateType, inputHash: candidate.inputHash, matrixHash: candidate.matrixHash, incidentHash: candidate.incidentHash, contextHash: candidate.contextHash, routes: candidate.routes.map((route) => ({ routeId: route.routeId, vehicleId: route.vehicleId, orderIds: route.orderIds })), historicalPrefixes: candidate.historicalPrefixes, unassignedOrderIds });
    candidate.verification = RollingPlan.verifyCandidate(candidate, context);
    candidate.pinningHash = candidate.verification.pinningHash;
    return candidate;
  }

  function carryForward(basePlan, scenario, contextInput, matrix, options = {}) {
    const context = RollingPlan.normalizeContext(contextInput); const remaining = new Set(scenario.orders.map((order) => order.id));
    const routes = (basePlan.routes || []).map((route) => ({ ...clone(route), orderIds: (route.orderIds || []).filter((id) => remaining.has(id)) })).filter((route) => route.orderIds.length);
    const candidate = { schemaVersion: "stct-recovery-candidate-v1.6", candidateType: "CARRY_FORWARD_REFERENCE", reference: true, engine: "Reference", engineVersion: VERSION, inputHash: scenario.inputHash, matrixHash: matrix.matrixHash, incidentHash: text(options.incidentHash), contextHash: context.contextHash, routes, historicalPrefixes: clone(context.fixedRoutePrefixes), unassignedOrderIds: scenario.orders.map((order) => order.id).filter((id) => !routes.some((route) => route.orderIds.includes(id))), providerProvenance: clone(matrix.providerProvenance || context.providerProvenance) };
    candidate.planHash = IntegrityHash.hashValue({ candidateType: candidate.candidateType, inputHash: candidate.inputHash, matrixHash: candidate.matrixHash, routes: routes.map((route) => ({ routeId: route.routeId, vehicleId: route.vehicleId, orderIds: route.orderIds })), unassignedOrderIds: candidate.unassignedOrderIds });
    candidate.verification = { ...RollingPlan.verifyCandidate(candidate, context), status: "REFERENCE" };
    candidate.pinningHash = candidate.verification.pinningHash; return candidate;
  }

  function solveRequestIdentity(value) {
    return {
      schemaVersion: "stct-rolling-solve-request-v1.6",
      rollingContextHash: value.rollingContextHash,
      derivedInputHash: value.derivedInputHash,
      matrixHash: value.matrixHash,
      objective: value.objective,
      timeLimitSeconds: value.timeLimitSeconds,
      fixedAssignments: value.fixedAssignments,
      fixedPrefixes: value.fixedPrefixes,
      changePenaltyWeights: value.changePenaltyWeights,
      incidentHash: value.incidentHash,
    };
  }

  function buildSolveRequest(scenario, contextInput, matrix, options = {}) {
    const context = RollingPlan.normalizeContext(contextInput);
    if (scenario.inputHash !== IntegrityHash.hashValue(RollingPlan.scenarioIdentity(scenario))) fail("DERIVED_INPUT_HASH_STALE", "Derived scenario inputHash is stale.");
    if (matrix.matrixHash !== context.matrixHash || scenario.matrixHash !== matrix.matrixHash) fail("ROLLING_MATRIX_HASH_MISMATCH", "Rolling context, derived scenario, and matrix hashes must match.");
    const activeVehicle = activeVehicleByOrder(scenario); const fixed = new Map(context.loadedOrderAssignments.map((row) => [row.orderId, row.vehicleId])); activeVehicle.forEach((vehicleId, orderId) => fixed.set(orderId, vehicleId));
    const request = {
      schemaVersion: "stct-rolling-solve-request-v1.6",
      rollingContext: context,
      rollingContextHash: context.contextHash,
      derivedScenario: clone(scenario),
      derivedInputHash: scenario.inputHash,
      authoritativeMatrix: clone(matrix),
      matrixHash: matrix.matrixHash,
      matrixPointIds: clone(matrix.sourceIds),
      objective: text(options.objective || "MINIMIZE_ROAD_DISTANCE_AND_CHANGE"),
      timeLimitSeconds: Math.max(1, Math.min(45, Math.trunc(number(options.timeLimitSeconds, 5)))),
      fixedAssignments: [...fixed].map(([orderId, vehicleId]) => ({ orderId, vehicleId })).sort((a, b) => a.orderId.localeCompare(b.orderId, "en")),
      fixedPrefixes: clone(context.fixedRoutePrefixes),
      changePenaltyWeights: { ...ChangePenalty.DEFAULT_WEIGHTS, ...(options.changePenaltyWeights || {}) },
      incidentHash: text(options.incidentHash),
    };
    request.claimedRequestHash = IntegrityHash.hashValue(solveRequestIdentity(request));
    request.claimedInputHash = scenario.inputHash;
    return request;
  }

  function normalizeFullCandidate(body, scenario, contextInput, matrix, options = {}) {
    if (!body?.ok || !body?.candidate) fail(body?.error?.code || "FULL_REOPTIMIZATION_FAILED", body?.error?.message || "Full reoptimization did not return a candidate.", body?.error?.details || {});
    const context = RollingPlan.normalizeContext(contextInput); const realHttpEvidence = body.transportEvidence?.kind === "HTTP_FETCH" && text(body.actualOrtoolsVersion) && body.matrixProvenance?.authoritative === true && body.matrixProvenance?.fallbackUsed === false;
    const candidate = { ...clone(body.candidate), candidateType: "FULL_REOPTIMIZATION_OR_TOOLS", reference: false, engine: "OR-Tools", engineVersion: text(body.actualOrtoolsVersion || body.engineVersion), inputHash: scenario.inputHash, matrixHash: matrix.matrixHash, incidentHash: text(options.incidentHash), contextHash: context.contextHash, historicalPrefixes: clone(context.fixedRoutePrefixes), providerProvenance: clone(body.matrixProvenance || matrix.providerProvenance), integrationEvidence: realHttpEvidence ? { status: "VERIFIED_HTTP_INTEGRATION", transport: "HTTP_FETCH", endpoint: text(body.transportEvidence.endpoint), requestHash: text(body.requestHash), actualOrtoolsVersion: text(body.actualOrtoolsVersion) } : { status: "UNIT_CALLBACK_ONLY", transport: text(body.transportEvidence?.kind || "CALLBACK") } };
    candidate.verification = RollingPlan.verifyCandidate(candidate, context); candidate.pinningHash = candidate.verification.pinningHash;
    if (candidate.verification.status !== "PASS") fail("FULL_CANDIDATE_PINNING_FAIL", "Full reoptimization candidate violates rolling pinning.", candidate.verification);
    return candidate;
  }

  function createHttpAdapter(options = {}) {
    const endpoint = text(options.endpoint || "http://127.0.0.1:8787").replace(/\/$/, ""); const fetcher = options.fetch || (typeof fetch === "function" ? fetch : null);
    if (!fetcher) fail("FETCH_UNAVAILABLE", "A fetch implementation is required for the OR-Tools HTTP adapter.");
    return async function solveFull(request, context = {}) {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), Math.max(1000, number(context.timeoutMs, (request.timeLimitSeconds + 5) * 1000)));
      context.onController?.(controller);
      try {
        const response = await fetcher(`${endpoint}/reoptimize-v16`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: controller.signal });
        const body = await response.json(); if (!response.ok) fail(body?.error?.code || "FULL_REOPTIMIZATION_HTTP_FAIL", body?.error?.message || `HTTP ${response.status}`, body?.error?.details || {}); return { ...body, transportEvidence: { kind: "HTTP_FETCH", endpoint: `${endpoint}/reoptimize-v16`, status: response.status } };
      } catch (error) {
        if (error.name === "AbortError") fail("FULL_REOPTIMIZATION_TIMEOUT", "Full reoptimization timed out or was cancelled."); throw error;
      } finally { clearTimeout(timeout); }
    };
  }

  async function candidatePool(options = {}) {
    const { basePlan, scenario, context, matrix } = options; const lifecycle = options.lifecycle || JobLifecycle.create(); const solveRequest = buildSolveRequest(scenario, context, matrix, options); const job = lifecycle.submit(solveRequest.claimedRequestHash);
    if (job.duplicate) return { status: "DUPLICATE", job, candidates: [] };
    let current = lifecycle.transition(job.jobId, "QUEUED", { stage: "Queued" }); current = lifecycle.transition(job.jobId, "MATRIX_READY", { stage: "Authoritative road matrix verified", matrixHash: matrix.matrixHash });
    const candidates = [carryForward(basePlan, scenario, context, matrix, options), localCandidate("LOCAL_REGRET_INSERTION", scenario, context, matrix, options), localCandidate("LOCAL_RUIN_RECREATE", scenario, context, matrix, options)];
    try {
      current = lifecycle.transition(job.jobId, "SOLVING", { stage: "OR-Tools solving" });
      if (typeof options.fullAdapter === "function") {
        const body = await options.fullAdapter(solveRequest, { jobId: job.jobId, timeoutMs: options.timeoutMs });
        candidates.push(normalizeFullCandidate(body, scenario, context, matrix, options));
      } else if (options.requireFull !== false) fail("FULL_REOPTIMIZATION_ADAPTER_REQUIRED", "Full OR-Tools HTTP adapter is required.");
      current = lifecycle.transition(job.jobId, "VERIFYING", { stage: "Verifier gate" });
      const nonReference = candidates.filter((candidate) => !candidate.reference); const failed = nonReference.filter((candidate) => candidate.verification.status !== "PASS");
      if (failed.length) fail("RECOVERY_CANDIDATE_VERIFICATION_FAIL", "One or more recovery candidates failed verifier.", { planHashes: failed.map((candidate) => candidate.planHash) });
      candidates.forEach((candidate) => { candidate.changePenalty = ChangePenalty.calculate(basePlan, candidate, context, options.changePenaltyWeights); });
      current = lifecycle.transition(job.jobId, "COMPLETED", { stage: "Completed", result: { candidateCount: candidates.length } });
      return { status: "PASS", job: current, candidates, serviceLayer: { comparable: candidates.filter((candidate) => !candidate.reference), reference: candidates.find((candidate) => candidate.reference), matrixHash: matrix.matrixHash, inputHash: scenario.inputHash } };
    } catch (error) {
      const latest = lifecycle.get(job.jobId); if (!JobLifecycle.TERMINAL.has(latest.state)) current = lifecycle.transition(job.jobId, error.code === "FULL_REOPTIMIZATION_TIMEOUT" ? "CANCELLED" : "FAILED", { stage: error.code || "Failed", error: { code: error.code || "REOPTIMIZATION_FAILED", message: error.message } });
      error.job = current; throw error;
    }
  }

  return { VERSION, matrixContext, localCandidate, carryForward, solveRequestIdentity, buildSolveRequest, normalizeFullCandidate, createHttpAdapter, candidatePool };
});
