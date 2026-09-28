(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) { root.STCTPlatformV19 = root.STCTPlatformV19 || {}; root.STCTPlatformV19.operationalValidationInbox = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const deepFreeze = (value) => { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); };
  const csv = (value) => { const source = String(value ?? ""); const safe = /^[\t\r\n ]*[=+\-@]/.test(source) ? `'${source}` : source; return `"${safe.replaceAll('"', '""')}"`; };
  function identity(result) { const value = clone(result); delete value.resultHash; return value; }
  function validate(store, result) {
    if (!result?.resultHash || result.resultHash !== store.context.Contract.hashArtifact(identity(result))) return { status: "FAIL", code: "DESIGN_VALIDATION_HASH_MISMATCH" };
    return { status: "PASS", code: "" };
  }
  function classify(source, store, result) {
    if (!result?.schemaVersion || !result?.resultHash) return "LEGACY";
    if (validate(store, result).status !== "PASS" || result.verifierStatus === "FAIL" || result.status === "FAILED") return "FAILED";
    if (result.sourceStudyId !== source.studyId || result.sourceScenarioHash !== source.activeInputHash || result.sourceMatrixHash !== store.context.Contract.identityBundle(source.activeRecord.scenario).routingContextHash) return "STALE";
    if (result.verifierStatus !== "PASS" || !Object.values(result.metrics || {}).some(value => Number.isFinite(value))) return "PENDING";
    return "VALID";
  }
  function states(source, store, result) {
    const artifactIntegrity = !result?.schemaVersion || !result?.resultHash ? "LEGACY_UNVERIFIED" : validate(store, result).status === "PASS" ? "VALID" : "INVALID";
    const freshness = artifactIntegrity !== "VALID" ? "UNKNOWN" : result.sourceScenarioHash === source.activeInputHash && result.sourceMatrixHash === store.context.Contract.identityBundle(source.activeRecord.scenario).routingContextHash ? "CURRENT" : "STALE";
    const businessVerification = artifactIntegrity !== "VALID" ? "UNVERIFIABLE" : result.verifierStatus === "FAIL" || result.status === "FAILED" ? "FAIL" : result.verifierStatus === "PASS" && Object.values(result.metrics || {}).some(value => Number.isFinite(value)) ? "PASS" : ["PENDING", "RUNNING"].includes(result.status) ? result.status : "NOT_RUN";
    return {artifactIntegrity,businessVerification,freshness};
  }
  function compare(rows) {
    const candidates=rows.filter(row=>row.inboxStatus==='VALID').slice(0,3).map(row=>{
      const service=Number(row.metrics?.service),cost=Number(row.metrics?.operationalCost),fleet=Number(row.metrics?.fleetRequirement);
      return {...clone(row),operationalScore:{service:Number.isFinite(service)?service:null,cost:Number.isFinite(cost)?cost:null,fleet:Number.isFinite(fleet)?fleet:null}};
    });
    candidates.sort((a,b)=>(b.operationalScore.service??-Infinity)-(a.operationalScore.service??-Infinity)||(a.operationalScore.cost??Infinity)-(b.operationalScore.cost??Infinity)||(a.operationalScore.fleet??Infinity)-(b.operationalScore.fleet??Infinity));
    return {policy:'VERIFIED_SERVICE_DESC_THEN_COST_ASC_THEN_FEASIBLE_FLEET_ASC',scope:'OPERATIONAL_VALIDATION_ONLY',strategicObjectiveUnchanged:true,candidates:candidates.map((row,index)=>({...row,operationalRank:index+1})),recommendation:candidates[0]?{validationId:candidates[0].validationId,bridgeResultRef:candidates[0].bridgeResultRef,reason:'Highest verified service; ties use lower operational cost then feasible used vehicles.'}:null};
  }
  function project(store, filters = {}) {
    const source = store.snapshot();
    const statusFilter = String(filters.status || "ALL");
    const rows = source.validations.map((result) => ({ ...clone(result), inboxStatus: classify(source, store, result), ...states(source, store, result), sourceStudyId: result.sourceStudyId || "LEGACY_UNKNOWN", sourceStudyHash: result.sourceStudyHash || "", resultHash: result.resultHash || "", verifierStatus: result.verifierStatus || "NOT_RECORDED", metrics: { service: result.metrics?.service ?? null, fleetRequirement: result.metrics?.fleetRequirement ?? null, routeDistanceKm: result.metrics?.routeDistanceKm ?? null, routeDurationMinutes: result.metrics?.routeDurationMinutes ?? null, dockPressure: result.metrics?.dockPressure ?? null, waveRisk: result.metrics?.waveRisk ?? null, driverRisk: result.metrics?.driverRisk ?? null, operationalCost: result.metrics?.operationalCost ?? null, carbonKg: result.metrics?.carbonKg ?? null }, warnings: result.warnings || [] })).filter((row) => statusFilter === "ALL" || row.inboxStatus === statusFilter);
    return { schemaVersion: "stct-operational-validation-inbox-v1.9-p6", status: source.validations.length ? "RESULTS_AVAILABLE" : "EMPTY", items: rows, comparison:compare(rows), counts: Object.fromEntries(["VALID", "PENDING", "STALE", "FAILED", "LEGACY"].map((status) => [status, source.validations.filter((row) => classify(source, store, row) === status).length])), filters: { status: statusFilter }, bridgeStatus: "P6_OPERATIONAL_VALIDATION_BRIDGE_ACTIVE", bridgeOwner: "OperationalValidationBridge", readOnly: true, canWriteCommandPlan: false, canStartExecution: false, canApplyRecovery: false, externalRequests: 0, primaryAction: "VALIDATE_SAVED_DESIGN_SCENARIO", sourceAuthority: "DesignStudyStore" };
  }
  function importReadOnly(store, payload) {
    let candidate;
    try { candidate = typeof payload === "string" ? JSON.parse(payload) : clone(payload); } catch (_error) { return { status: "FAIL", code: "DESIGN_VALIDATION_JSON_INVALID", mode: "READ_ONLY" }; }
    const verification = validate(store, candidate);
    if (verification.status !== "PASS") return { ...verification, mode: "READ_ONLY" };
    return deepFreeze({ status: "PASS", mode: "READ_ONLY", pack: clone(candidate), sourceResultHash: candidate.resultHash, sideEffects: { commandPlanMutation: false, executionStarted: false, recoveryApplied: false, externalRequests: 0 } });
  }
  function toJson(store, filters = {}) { return `${JSON.stringify(project(store, filters), null, 2)}\n`; }
  function toCsv(store, filters = {}) { return `validation_id,inbox_status,source_study_id,source_study_hash,result_hash,verifier,service,fleet,route_km,duration_min,dock_pressure,wave_risk,driver_risk,cost,carbon_kg\n${project(store, filters).items.map((row) => [row.validationId, row.inboxStatus, row.sourceStudyId, row.sourceStudyHash, row.resultHash, row.verifierStatus, row.metrics.service ?? "MISSING", row.metrics.fleetRequirement ?? "MISSING", row.metrics.routeDistanceKm ?? "MISSING", row.metrics.routeDurationMinutes ?? "MISSING", row.metrics.dockPressure ?? "MISSING", row.metrics.waveRisk ?? "MISSING", row.metrics.driverRisk ?? "MISSING", row.metrics.operationalCost ?? "MISSING", row.metrics.carbonKg ?? "MISSING"].map(csv).join(",")).join("\n")}\n`; }
  return Object.freeze({ project, compare, identity, validate, classify, states, importReadOnly, toJson, toCsv });
});
