(function (root, factory) {
  "use strict";
  const namespace = root.STCTPlatformV19 = root.STCTPlatformV19 || {};
  const StrategicContext = typeof module === "object" && module.exports ? require("./design-strategic-context-v19.js") : namespace.designStrategicContext;
  const api = factory(StrategicContext,typeof module === "object" && module.exports ? require("./platform-settings-v19.js") : namespace.settingsRegistry);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) namespace.designStudyStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (StrategicContext,Settings) {
  "use strict";

  const SCHEMA_VERSION = "stct-design-study-store-v1.9-p4";
  const LIFECYCLE = Object.freeze(["EMPTY", "DRAFT", "BASELINED", "SCENARIO_DIRTY", "EVALUATING", "READY_FOR_REVIEW", "STALE", "ARCHIVED"]);
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));

  function createStore(options = {}) {
    const context = options.context || StrategicContext.createContext(options);
    const Lab = context.ScenarioLab;
    const Contract = context.Contract;
    const baseline = Lab.baseline(context.scenario);
    let history = Lab.history(context.scenario);
    let revision = 1;
    let viewRevision = 0;
    let evaluation = null;
    let evaluationFailure = null;
    let lifecycle = options.staleReason ? "STALE" : "DRAFT";
    let archived = false;
    let cloneOfStudyHash = "";
    const results = new Map();
    const studyId = options.studyId || "DESIGN-STUDY-001";
    let demandPeriod = options.demandPeriod || "FY2027 STRATEGIC PLANNING HORIZON";
    const listeners = new Set();
    const validations = [];
    const audit = [{ action: "CREATE_STUDY", studyId, networkInputHash: baseline.inputHash }];
    const viewState = { route: "/design/overview", selectedDepotId: context.scenario.depots[0]?.depotId || "", selectedScenarioId: baseline.scenarioId, selectedPortfolioId: "", quickFinderQuery: "", panel: "", filters: { scenarioType: "ALL", actionStatus: "OPEN" }, returnRoute: "" };

    function currentRecord() { return Lab.active(history); }
    function businessProjection() {
      const resultRefs = [...results.values()].map((result) => ({ scenarioId: result.scenarioId, networkInputHash: result.networkInputHash, evaluationHash: result.evaluationHash, planHash: result.plan.networkPlanHash, accountingHash: result.accounting.accountingHash, verification: result.verification.status, accountingVerification: result.accountingVerification.status, service: result.accounting.metrics.serviceLevel, cost: result.accounting.cost.total, carbonKg: result.accounting.carbon.totalKg, vehicles: result.plan.trip.tripChains.length, trips: result.plan.trip.trips.length, dockCongestion: result.accounting.metrics.dockCongestion, emptyDistanceKm: result.accounting.metrics.emptyDistanceKm, unassigned: result.plan.trip.unassigned.length, provider: result.plan.engine.used, status: result.plan.status }));
      return { schemaVersion: SCHEMA_VERSION, studyId, lifecycle, archived, revision, cloneOfStudyHash, strategicHorizon: currentRecord().scenario.planningHorizon.mode, demandPeriod, baselineScenarioId: baseline.scenarioId, baselineInputHash: baseline.inputHash, activeScenarioId: currentRecord().scenarioId, activeInputHash: currentRecord().inputHash, baselineResultRef: resultRefs.find((row) => row.scenarioId === baseline.scenarioId) || null, scenarioResultRefs: resultRefs, operationalValidationRefs: validations.map((row) => ({ validationId: row.validationId, status: row.status, sourceScenarioHash: row.sourceScenarioHash, bridgeResultRef: row.bridgeResultRef || null })), dataGaps: ["LAND_AVAILABILITY_NOT_CONNECTED", "REAL_ESTATE_COST_NOT_CONNECTED", "ROAD_ECONOMIC_MATRIX_SYNTHETIC_ONLY"], dirty: ["DRAFT", "SCENARIO_DIRTY", "STALE"].includes(lifecycle), history: history.records.map((record) => ({ scenarioId: record.scenarioId, type: record.type, revision: record.revision, parentScenarioId: record.parentScenarioId, parentInputHash: record.parentInputHash, inputHash: record.inputHash, changeHash: record.changeHash })), cursor: history.cursor, evaluation: evaluation ? { scenarioId: evaluation.scenarioId, networkInputHash: evaluation.networkInputHash, evaluationHash: evaluation.evaluationHash, planHash: evaluation.plan.networkPlanHash, accountingHash: evaluation.accounting.accountingHash } : null, validations: clone(validations), auditEvents: clone(audit), audit: clone(audit) };
    }
    function studyHash() { return Contract.hashArtifact(businessProjection()); }
    function snapshot() {
      return Object.freeze({ ...clone(businessProjection()), studyHash: studyHash(), selectedScenarioIds: [currentRecord().scenarioId], selectedFacilityId: viewState.selectedDepotId, selectedDepotId: viewState.selectedDepotId, selectedZoneId: viewState.selectedDepotId.replace(/^D/, "Z"), selectedPortfolioId: viewState.selectedPortfolioId, dataSource: { schemaVersion: context.dataSource.schemaVersion, sourceType: context.dataSource.sourceType, sourceRef: context.dataSource.sourceRef, dataClassification: context.dataSource.dataClassification, authority: context.dataSource.authority, shape: clone(context.dataSource.shape) }, baseline: clone(baseline), activeRecord: clone(currentRecord()), evaluation: clone(evaluation), evaluationFailure: clone(evaluationFailure), lifecycle, viewState: clone(viewState), viewRevision });
    }
    function emit(reason) { const value = snapshot(); listeners.forEach((listener) => listener(value, reason)); return value; }
    function mutate(action, operation) {
      if (archived) throw Object.assign(new Error("Archived study is read-only"), { code: "DESIGN_STUDY_ARCHIVED" });
      const before = { history: clone(history), evaluation, lifecycle, archived, demandPeriod, viewState: clone(viewState), results: [...results], validations: clone(validations) };
      let result;
      try { result = operation(); } catch (error) {
        history = before.history; evaluation = before.evaluation; lifecycle = before.lifecycle; archived = before.archived; demandPeriod = before.demandPeriod;
        Object.assign(viewState, before.viewState); results.clear(); before.results.forEach(([key,value]) => results.set(key,value)); validations.splice(0,validations.length,...before.validations);
        evaluationFailure = { code: error.code || "DESIGN_OPERATION_FAILED", message: error.message, inputHash: currentRecord().inputHash };
        emit("OPERATION_REJECTED");
        throw error;
      }
      revision += 1;
      audit.push({ action, revision, activeInputHash: currentRecord().inputHash });
      return { result, snapshot: emit(action) };
    }
    function ensureCurrent(candidate) {
      const staleness = Lab.resultStaleness(currentRecord(), candidate);
      if (staleness.status !== "CURRENT") {
        throw Object.assign(new Error("Evaluation belongs to another scenario input"), { code: "DESIGN_STALE_EVALUATION_REJECTED", staleness });
      }
    }
    function admit(candidate) {
      const expectedRevision = revision;
      const record = clone(currentRecord());
      return context.admit(record, candidate, { isCurrent: () => revision === expectedRevision && currentRecord().inputHash === record.inputHash && currentRecord().scenarioId === record.scenarioId });
    }
    function cached(record) {
      const candidate = results.get(record.scenarioId) || [...results.values()].find(value => value.networkInputHash === record.inputHash);
      return candidate ? context.admit(record, candidate) : null;
    }
    function baselineStudy() {
      return mutate("BASELINE_STUDY", () => {
        history = Lab.history(context.scenario);
        evaluation = context.evaluate(currentRecord());
        evaluationFailure = null;
        results.set(currentRecord().scenarioId, evaluation);
        lifecycle = "BASELINED";
        viewState.selectedScenarioId = currentRecord().scenarioId;
        return clone(evaluation);
      });
    }
    function createScenario(type, payload = {}) {
      return mutate("CREATE_SCENARIO", () => {
        history = Lab.pushHistory(history, type, payload);
        evaluation = cached(currentRecord());
        evaluationFailure = null;
        lifecycle = "SCENARIO_DIRTY";
        viewState.selectedScenarioId = currentRecord().scenarioId;
        return clone(currentRecord());
      });
    }
    function createShock(shock, payload = {}) {
      return mutate("CREATE_SHOCK", () => {
        const record = Lab.applyShock(currentRecord(), shock, payload);
        record.impactBaseline = evaluation ? { networkInputHash: evaluation.networkInputHash, assignments: clone(evaluation.plan.assignment.assignments), servedOrderIds: evaluation.plan.trip.trips.flatMap(trip => trip.orderIds) } : null;
        history = { baseline: history.baseline, records: [...history.records.slice(0, history.cursor + 1), record], cursor: history.cursor + 1 };
        evaluation = cached(record);
        evaluationFailure = null;
        lifecycle = "SCENARIO_DIRTY";
        viewState.selectedScenarioId = record.scenarioId;
        return clone(record);
      });
    }
    function evaluate(optionsValue = {}) {
      return mutate("EVALUATE_SCENARIO", () => {
        lifecycle = "EVALUATING";
        let candidate;
        try {
          candidate = context.evaluate(currentRecord(), optionsValue);
        } catch (error) {
          evaluationFailure = { code: error.code || "DESIGN_EVALUATION_FAILED", message: error.message, inputHash: currentRecord().inputHash };
          lifecycle = "SCENARIO_DIRTY";
          throw error;
        }
        ensureCurrent(candidate);
        evaluation = admit(candidate);
        evaluationFailure = null;
        results.set(currentRecord().scenarioId, evaluation);
        lifecycle = "READY_FOR_REVIEW";
        return clone(candidate);
      });
    }
    function acceptEvaluation(candidate) {
      return mutate("ACCEPT_EVALUATION", () => {
        ensureCurrent(candidate);
        evaluation = admit(candidate);
        evaluationFailure = null;
        results.set(currentRecord().scenarioId, evaluation);
        lifecycle = "READY_FOR_REVIEW";
        return clone(evaluation);
      });
    }
    function undo() {
      return mutate("UNDO_SCENARIO", () => {
        history = Lab.undo(history);
        evaluation = cached(currentRecord());
        evaluationFailure = null;
        lifecycle = history.cursor ? (evaluation ? "READY_FOR_REVIEW" : "SCENARIO_DIRTY") : "BASELINED";
        viewState.selectedScenarioId = currentRecord().scenarioId;
        if (history.cursor === 0) evaluation = context.evaluate(currentRecord());
        return clone(currentRecord());
      });
    }
    function redo() {
      return mutate("REDO_SCENARIO", () => {
        history = { ...history, cursor: Math.min(history.records.length - 1, history.cursor + 1) };
        evaluation = cached(currentRecord());
        evaluationFailure = null;
        lifecycle = history.cursor ? (evaluation ? "READY_FOR_REVIEW" : "SCENARIO_DIRTY") : "BASELINED";
        viewState.selectedScenarioId = currentRecord().scenarioId;
        if (history.cursor === 0) evaluation = context.evaluate(currentRecord());
        return clone(currentRecord());
      });
    }
    function reset() {
      return mutate("RESET_TO_BASELINE", () => {
        history = Lab.history(context.scenario);
        evaluation = context.evaluate(currentRecord());
        evaluationFailure = null;
        results.set(currentRecord().scenarioId, evaluation);
        lifecycle = "BASELINED";
        Object.assign(viewState, { selectedDepotId: context.scenario.depots[0]?.depotId || "", selectedScenarioId: currentRecord().scenarioId, selectedPortfolioId: "", quickFinderQuery: "", panel: "" });
        return clone(evaluation);
      });
    }
    function setView(patch = {}) {
      const allowed = ["route", "selectedDepotId", "selectedScenarioId", "selectedPortfolioId", "quickFinderQuery", "panel", "filters", "returnRoute"];
      for (const key of allowed) if (Object.prototype.hasOwnProperty.call(patch, key)) viewState[key] = clone(patch[key]);
      viewRevision += 1;
      return emit("VIEW_STATE_CHANGED");
    }
    function setDemandPeriod(value) { const next = String(value || "").trim(); if (!next) throw Object.assign(new Error("Demand period is required"), { code: "DESIGN_DEMAND_PERIOD_REQUIRED" }); return mutate("SET_DEMAND_PERIOD", () => { demandPeriod = next.slice(0, 120); return demandPeriod; }); }
    function applyBusinessSettings(settings) {
      return mutate("APPLY_BUSINESS_SETTINGS",()=>{
        if(!Number.isFinite(settings.tollPerKm)||settings.tollPerKm<0)throw Object.assign(new Error("Invalid toll rate"),{code:"COST_RATE_INVALID"});
        const parent=currentRecord(),scenario=clone(parent.scenario);
        scenario.assumptions={...scenario.assumptions,accountingOptions:{...scenario.assumptions.accountingOptions,tollPerKm:settings.tollPerKm},costNormalization:clone(settings.costNormalization||null)};
        if(settings.costNormalization&&scenario.assumptions.preparedCostContext){
          const source=scenario.assumptions.preparedCostContext.rows.map(({sourceAmount,sourcePeriod,normalizationHash,factor,...row})=>({...row,amount:sourceAmount,period:sourcePeriod}));
          scenario.assumptions.preparedCostContext={...Settings.normalizePeriods(source,settings.costNormalization),aggregationBoundary:'SOURCE_COST_PARAMETERS_ONLY_NOT_ADDED_TO_ROUTE_LEDGER',modelEstimate:true};
        }
        const normalized=Contract.normalizeScenario(scenario),inputHash=Contract.identityBundle(normalized).networkInputHash;
        const changeHash=Contract.hashArtifact({settings,parentInputHash:parent.inputHash,inputHash});
        const record={scenarioId:'SCENARIO-COST-'+changeHash.slice(-10),type:'COST_CONTEXT_CHANGE',revision:parent.revision+1,parentScenarioId:parent.scenarioId,parentInputHash:parent.inputHash,inputHash,changeHash,scenario:normalized,label:'Cost context',audit:[...parent.audit,{action:'COST_CONTEXT_CHANGED',settings:clone(settings)}]};
        history={...history,records:[...history.records.slice(0,history.cursor+1),record],cursor:history.cursor+1};evaluation=null;lifecycle='STALE';evaluationFailure=null;
        return clone(record);
      });
    }
    function cloneScenario() {
      return mutate("CLONE_SCENARIO", () => {
        const parent = currentRecord();
        const cloneKey = { parentScenarioId: parent.scenarioId, parentInputHash: parent.inputHash, revision: revision + 1, copyId: globalThis.crypto.randomUUID() };
        const record = { ...clone(parent), scenarioId: `SCENARIO-CLONE-${Contract.hashArtifact(cloneKey).slice(-10).toUpperCase()}`, revision: parent.revision + 1, parentScenarioId: parent.scenarioId, parentInputHash: parent.inputHash, changeHash: Contract.hashArtifact({ action: "CLONE_SCENARIO", ...cloneKey }), label: `${parent.label} Clone`, audit: [...parent.audit, { action: "CLONE_SCENARIO", ...cloneKey }] };
        history = { baseline: history.baseline, records: [...history.records.slice(0, history.cursor + 1), record], cursor: history.cursor + 1 };
        evaluation = cached(record);
        if (evaluation) results.set(record.scenarioId, evaluation);
        evaluationFailure = null;
        lifecycle = evaluation ? "READY_FOR_REVIEW" : "SCENARIO_DIRTY";
        viewState.selectedScenarioId = record.scenarioId;
        return clone(record);
      });
    }
    function addOperationalValidation(result) {
      return mutate("ADD_OPERATIONAL_VALIDATION", () => {
        const currentStudyHash = studyHash();
        if (result.sourceStudyHash && result.sourceStudyHash !== currentStudyHash) throw Object.assign(new Error("Operational validation belongs to a stale Study hash"), { code: "DESIGN_VALIDATION_STUDY_HASH_STALE" });
        const identity = {
          schemaVersion: "stct-operational-validation-result-v1.9-p4",
          validationId: result.validationId || `VALIDATION-${validations.length + 1}`,
          sourceStudyId: result.sourceStudyId || studyId,
          sourceStudyHash: result.sourceStudyHash || currentStudyHash,
          sourceStudyRevision: revision,
          sourceScenarioHash: result.sourceScenarioHash || currentRecord().inputHash,
          sourceMatrixHash: result.sourceMatrixHash || context.routingContextHash,
          status: result.status || "PENDING",
          verifierStatus: result.verifierStatus || "NOT_RUN",
          metrics: clone(result.metrics || {}),
          warnings: clone(result.warnings || []),
          source: result.source || "P6_OPERATIONAL_VALIDATION_BRIDGE",
          summary: result.summary || "Awaiting COMMAND operational validation",
          bridgeResultRef: result.bridgeResultRef || null,
          readOnly: true,
        };
        const row = { ...identity, resultHash: Contract.hashArtifact(identity) };
        validations.push(row);
        return clone(row);
      });
    }
    function removeOperationalValidation(validationId) {
      return mutate("REMOVE_OPERATIONAL_VALIDATION_ATTACHMENT", () => {
        const index=validations.findIndex(row=>row.validationId===validationId);
        if(index<0)throw Object.assign(new Error("Operational validation attachment not found"),{code:"DESIGN_VALIDATION_ATTACHMENT_NOT_FOUND"});
        return clone(validations.splice(index,1)[0]);
      });
    }
    function archive() { return mutate("ARCHIVE_STUDY", () => { lifecycle = "ARCHIVED"; archived = true; return { status: "ARCHIVED" }; }); }
    function cloneStudy() { const value = snapshot(); return { schemaVersion: SCHEMA_VERSION, mode: "NEW_STUDY_DRAFT", targetStudyId: `${studyId}-COPY-${String(revision + 1).padStart(3, "0")}`, cloneOfStudyHash: value.studyHash, sourceStudyId: value.studyId, scenario: clone(value.activeRecord.scenario), sourceEvaluationHash: value.evaluation?.evaluationHash || "" }; }
    function exportReadOnly() { const payload = { schemaVersion: "stct-design-study-readonly-v1.9-p4", mode: "READ_ONLY", study: businessProjection(), studyHash: studyHash() }; payload.exportHash = Contract.hashArtifact(payload); return clone(payload); }
    function importReadOnly(payload) {
      const candidate = clone(payload);
      const expected = candidate?.exportHash;
      if (!expected) return { status: "FAIL", code: "DESIGN_IMPORT_HASH_MISSING" };
      delete candidate.exportHash;
      if (Contract.hashArtifact(candidate) !== expected || candidate.studyHash !== Contract.hashArtifact(candidate.study)) return { status: "FAIL", code: "DESIGN_IMPORT_HASH_MISMATCH" };
      return Object.freeze({ status: "PASS", mode: "READ_ONLY", pack: clone(payload), sourceStudyHash: candidate.studyHash });
    }
    function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    function exportSnapshot() {
      return clone({schemaVersion:"stct-study-snapshot-p5",studyId,dataSource:context.dataSource,history,revision,demandPeriod,lifecycle,archived,viewState,results:[...results.values()].filter(result=>history.records.some(record=>record.scenarioId===result.scenarioId)).map(({artifact,...result})=>result),validations,audit,activeScenarioId:currentRecord().scenarioId});
    }
    function restoreSnapshot(input) {
      const candidate = clone(input);
      if(candidate.schemaVersion!=="stct-study-snapshot-p5"||candidate.studyId!==studyId)throw Object.assign(new Error("Study snapshot identity mismatch"),{code:"STUDY_SNAPSHOT_INVALID"});
      if(!candidate.history?.records?.length||!Number.isInteger(candidate.history.cursor)||!candidate.history.records[candidate.history.cursor])throw Object.assign(new Error("Scenario history invalid"),{code:"STUDY_HISTORY_INVALID"});
      const prepared = new Map();
      for(const record of candidate.history.records)if(record.inputHash!==Contract.identityBundle(record.scenario).networkInputHash)throw Object.assign(new Error("Scenario input mismatch"),{code:"STUDY_INPUT_MISMATCH"});
      for(const result of candidate.results){
        const record=candidate.history.records.find(row=>row.scenarioId===result.scenarioId);
        if(!record)throw Object.assign(new Error("Orphan result"),{code:"STUDY_RESULT_REFERENCE_MISSING"});
        prepared.set(record.scenarioId,context.admit(record,result));
      }
      if(candidate.history.records[0].inputHash!==baseline.inputHash)throw Object.assign(new Error("Baseline mismatch"),{code:"STUDY_BASELINE_MISMATCH"});
      history=candidate.history;revision=candidate.revision;demandPeriod=candidate.demandPeriod;archived=Boolean(candidate.archived);
      results.clear();prepared.forEach((value,key)=>results.set(key,value));evaluation=results.get(currentRecord().scenarioId)||null;
      lifecycle=archived?"ARCHIVED":evaluation?"READY_FOR_REVIEW":"SCENARIO_DIRTY";
      validations.splice(0,validations.length,...candidate.validations);audit.splice(0,audit.length,...candidate.audit);
      Object.assign(viewState,candidate.viewState);evaluationFailure=null;
      return snapshot();
    }
    function diagnostics() { return { schemaVersion: SCHEMA_VERSION, lifecycle, revision, viewRevision, listenerCount: listeners.size, historyLength: history.records.length, externalRequests: 0, context: context.diagnostics() }; }

    const api = { schemaVersion: SCHEMA_VERSION, context, baselineStudy, createScenario, createShock, cloneScenario, evaluate, acceptEvaluation, undo, redo, reset, setView, setDemandPeriod, applyBusinessSettings, addOperationalValidation, removeOperationalValidation, archive, cloneStudy, exportReadOnly, importReadOnly, snapshot, exportSnapshot, restoreSnapshot, subscribe, diagnostics, activeRecord: () => clone(currentRecord()) };
    if (options.deferBaseline !== true) baselineStudy();
    return Object.freeze(api);
  }

  function fromSnapshot(value) {
    if(!value?.dataSource?.scenario?.routingContext?.providerId)throw Object.assign(new Error("Stored input dependencies are missing"),{code:"STUDY_DEPENDENCIES_MISSING"});
    const context=StrategicContext.createContext({dataSource:clone(value.dataSource)});
    const store=createStore({context,studyId:value.studyId,deferBaseline:true});
    store.restoreSnapshot(value);
    return store;
  }
  return Object.freeze({ SCHEMA_VERSION, LIFECYCLE, createStore, fromSnapshot });
});
