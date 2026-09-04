(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const api = factory(integrity);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV16 = root.STCTV16 || { version: "1.6.0" }; root.STCTV16.rollingRecovery = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash) {
  "use strict";
  if (!IntegrityHash?.hashValue) throw new Error("Rolling Recovery v1.6 requires SHA-256 integrity utilities.");
  const VERSION = "stct-rolling-recovery-v1.6";
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  const number = (value, fallback = 0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
  function fail(code, message, detail = {}) { const error = new Error(message); error.code = code; error.detail = clone(detail); throw error; }

  function metric(candidate) {
    const routes = candidate.routes || [];
    return {
      assigned: routes.reduce((sum, route) => sum + (route.orderIds?.length || 0), 0),
      usedVehicles: routes.length,
      estimatedRoadKm: routes.reduce((sum, route) => sum + number(route.totalDistance ?? route.km), 0),
      changePenalty: number(candidate.changePenalty?.total),
      unassigned: candidate.unassignedOrderIds?.length || 0,
    };
  }

  function dominates(left, right) {
    const noWorse = left.unassigned <= right.unassigned && left.changePenalty <= right.changePenalty && left.estimatedRoadKm <= right.estimatedRoadKm;
    const better = left.unassigned < right.unassigned || left.changePenalty < right.changePenalty || left.estimatedRoadKm < right.estimatedRoadKm;
    return noWorse && better;
  }

  function observedPareto(candidates = []) {
    const rows = candidates.filter((candidate) => candidate.reference || candidate.verification?.status === "PASS").map((candidate) => ({ planHash: candidate.planHash, candidateType: candidate.candidateType, reference: candidate.reference === true, fullReoptimization: candidate.candidateType === "FULL_REOPTIMIZATION_OR_TOOLS", values: metric(candidate), candidate: clone(candidate) }));
    rows.forEach((row) => { row.observedFrontier = !rows.some((other) => other.planHash !== row.planHash && dominates(other.values, row.values)); });
    return { schemaVersion: "stct-observed-recovery-pareto-v1.6", label: "Observed Candidate Frontier", observedOnly: true, rows };
  }

  function fullAvailability(matrix, engine = {}) {
    const estimated = matrix?.estimated === true || matrix?.providerProvenance?.mode === "ESTIMATED" || matrix?.providerId === "ESTIMATED_HAVERSINE_FALLBACK";
    if (estimated) return { status: "DISABLED_BY_CONFIGURATION", fullAvailable: false, reason: "ROAD_MATRIX_REQUIRED" };
    if (engine.available === false || engine.status === "UNAVAILABLE_DEPENDENCY") return { status: "SKIPPED_DEPENDENCY", fullAvailable: false, reason: "ORTOOLS_UNAVAILABLE" };
    return { status: "READY", fullAvailable: true, reason: null };
  }

  function createSession(options = {}) {
    const basePlan = clone(options.basePlan || {}); const context = clone(options.context || {}); const incidentHash = text(options.incidentHash);
    if (!text(basePlan.planHash) || !text(context.contextHash) || !incidentHash) fail("ROLLING_SESSION_IDENTITY_REQUIRED", "Base plan, rolling context, and incident hash are required.");
    let activePlan = clone(basePlan); let revision = Math.max(0, Math.trunc(number(basePlan.revision))); let latestPool = null; let previewedPlanHash = ""; let applied = null; let generation = 0;
    const lineage = []; const postRecoveryAckEvents = [];

    function ingest(pool, metadata = {}) {
      if (metadata.generation !== undefined && metadata.generation !== generation) fail("STALE_JOB_RESPONSE", "A stale recovery job response was rejected.", { expectedGeneration: generation, actualGeneration: metadata.generation });
      const candidates = clone(pool?.candidates || []);
      candidates.forEach((candidate) => {
        if (candidate.candidateType === "FULL_REOPTIMIZATION_OR_TOOLS" && candidate.integrationEvidence?.status !== "VERIFIED_HTTP_INTEGRATION") candidate.integrationEvidence = { ...(candidate.integrationEvidence || {}), acceptedAsIntegrationEvidence: false };
      });
      latestPool = { ...clone(pool), candidates, observedPareto: observedPareto(candidates), ingestedGeneration: generation };
      return clone(latestPool);
    }

    function preview(planHash) {
      const candidate = latestPool?.candidates?.find((row) => row.planHash === text(planHash));
      if (!candidate || candidate.reference || candidate.verification?.status !== "PASS") fail("RECOVERY_PREVIEW_NOT_ALLOWED", "Only verifier-PASS non-reference candidates can be previewed.");
      previewedPlanHash = candidate.planHash;
      return { status: "PREVIEW", planHash: candidate.planHash, candidate: clone(candidate), handover: { cutoffLogicalMinute: context.cutoffLogicalMinute, beforeLabel: "Simulated Actual before cutoff", afterLabel: "Planned after cutoff" } };
    }

    function apply(planHash) {
      const candidate = latestPool?.candidates?.find((row) => row.planHash === text(planHash));
      if (!candidate || candidate.reference || candidate.verification?.status !== "PASS") fail("RECOVERY_APPLY_NOT_ALLOWED", "Only verifier-PASS non-reference candidates can be applied.");
      if (candidate.candidateType === "FULL_REOPTIMIZATION_OR_TOOLS" && candidate.integrationEvidence?.status !== "VERIFIED_HTTP_INTEGRATION") fail("FULL_REOPTIMIZATION_INTEGRATION_EVIDENCE_REQUIRED", "Full reoptimization apply requires verified HTTP OR-Tools evidence.");
      const previousPlan = clone(activePlan); const parentRevision = revision; revision += 1;
      const planRevision = { schemaVersion: "stct-execution-plan-revision-v1.6", revision, parentRevision, parentPlanHash: previousPlan.planHash, newPlanHash: candidate.planHash, incidentHash, recoveryRequestHash: text(latestPool?.requestHash || latestPool?.job?.requestHash), recoveryPlanHash: candidate.planHash, cutoffLogicalMinute: context.cutoffLogicalMinute, effectiveFromLogicalMinute: context.cutoffLogicalMinute };
      planRevision.revisionHash = IntegrityHash.hashValue(planRevision);
      activePlan = { ...clone(candidate), revision };
      applied = { candidate: clone(candidate), previousPlan, planRevision, appliedGeneration: generation };
      lineage.push({ action: "APPLY", ...clone(planRevision), integrationEvidence: clone(candidate.integrationEvidence || null) });
      return { status: "APPLIED", plan: clone(activePlan), planRevision: clone(planRevision) };
    }

    function recordPostRecoveryEvent(event = {}) {
      if (!applied) fail("RECOVERY_NOT_APPLIED", "No recovery plan is active.");
      const accepted = event.accepted !== false && number(event.logicalTime, -1) >= context.cutoffLogicalMinute && (text(event.ackId) || text(event.eventType) === "EVENT_ACKNOWLEDGED");
      if (accepted) postRecoveryAckEvents.push(clone(event));
      return { status: accepted ? "ACK_RECORDED" : "IGNORED", undoAllowed: postRecoveryAckEvents.length === 0 };
    }

    function undo() {
      if (!applied) return { status: "NO_ACTIVE_RECOVERY", plan: clone(activePlan) };
      if (postRecoveryAckEvents.length) fail("RECOVERY_UNDO_BLOCKED_BY_ACK", "Simple undo is blocked after a post-recovery acknowledged execution event. Create a counter-recovery instead.", { ackEventIds: postRecoveryAckEvents.map((row) => row.eventId) });
      const recoveryPlanHash = applied.candidate.planHash; activePlan = clone(applied.previousPlan); revision += 1;
      const row = { action: "UNDO", revision, recoveryPlanHash, restoredPlanHash: activePlan.planHash, incidentHash, cutoffLogicalMinute: context.cutoffLogicalMinute };
      row.revisionHash = IntegrityHash.hashValue(row); lineage.push(clone(row)); applied = null;
      return { status: "UNDONE", plan: clone(activePlan), planRevision: clone(row) };
    }

    function createCounterRecovery(reason = "POST_RECOVERY_ACK_ACCEPTED") {
      if (!applied || !postRecoveryAckEvents.length) fail("COUNTER_RECOVERY_NOT_REQUIRED", "Counter-recovery is available only after simple undo is blocked.");
      const value = { schemaVersion: "stct-counter-recovery-v1.6", parentIncidentHash: incidentHash, parentRecoveryPlanHash: applied.candidate.planHash, parentRevision: applied.planRevision.revision, currentPlanHash: activePlan.planHash, cutoffLogicalMinute: context.cutoffLogicalMinute, reason, ackEventHashes: postRecoveryAckEvents.map((row) => text(row.eventHash || IntegrityHash.hashValue(row))) };
      value.counterRecoveryHash = IntegrityHash.hashValue(value); lineage.push({ action: "COUNTER_RECOVERY_CREATED", ...clone(value) }); return value;
    }

    function beginGeneration() { generation += 1; return generation; }
    function exportLineage() { return { schemaVersion: "stct-full-reoptimization-lineage-v1.6", basePlanHash: basePlan.planHash, currentPlanHash: activePlan.planHash, contextHash: context.contextHash, executionRunHash: context.executionRunHash, executionStateHash: context.executionStateHash, incidentHash, matrixHash: context.matrixHash, transferPolicy: context.transferPolicy, revision, previewedPlanHash, postRecoveryAckEventHashes: postRecoveryAckEvents.map((row) => text(row.eventHash || IntegrityHash.hashValue(row))), actions: clone(lineage), candidateSummaries: clone((latestPool?.candidates || []).map((candidate) => ({ candidateType: candidate.candidateType, planHash: candidate.planHash, inputHash: candidate.inputHash, matrixHash: candidate.matrixHash, incidentHash: candidate.incidentHash, pinningHash: candidate.pinningHash, verificationStatus: candidate.verification?.status, integrationEvidence: candidate.integrationEvidence || null }))), observedPareto: clone(latestPool?.observedPareto || null) }; }
    function snapshot() { return { activePlan: clone(activePlan), revision, generation, previewedPlanHash, applied: clone(applied), undoAllowed: !postRecoveryAckEvents.length, lineage: clone(lineage) }; }
    return { ingest, preview, apply, recordPostRecoveryEvent, undo, createCounterRecovery, beginGeneration, exportLineage, snapshot };
  }

  return { VERSION, metric, dominates, observedPareto, fullAvailability, createSession };
});
