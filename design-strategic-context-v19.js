(function (root, factory) {
  "use strict";
  const namespace = root.STCTPlatformV19 = root.STCTPlatformV19 || {};
  const dependencies = typeof module === "object" && module.exports ? {
    Contract: require("./network-contract-v18.js"),
    Solver: require("./network-solver-v18.js"),
    Accounting: require("./network-accounting-v18.js"),
    ScenarioLab: require("./scenario-lab-v18.js"),
    Visualization: require("./network-visualization-v18.js"),
    DataAdapter: require("./design-data-adapter-v19.js"),
    Admission: require("./result-admission-v19.js"),
  } : {
    Contract: root.STCTV18?.networkContract,
    Solver: root.STCTV18?.networkSolver,
    Accounting: root.STCTV18?.networkAccounting,
    ScenarioLab: root.STCTV18?.scenarioLab,
    Visualization: root.STCTV18?.networkVisualization,
    DataAdapter: namespace.designDataAdapter,
    Admission: namespace.resultAdmission,
  };
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) namespace.designStrategicContext = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (dependencies) {
  "use strict";

  const SCHEMA_VERSION = "stct-design-strategic-context-v1.9-p4";
  const REQUIRED = ["Contract", "Solver", "Accounting", "ScenarioLab", "Visualization", "DataAdapter", "Admission"];
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();

  function ensureDependencies() {
    const missing = REQUIRED.filter((key) => !dependencies[key]);
    if (missing.length) throw Object.assign(new Error(`Missing DESIGN dependencies: ${missing.join(", ")}`), { code: "DESIGN_DEPENDENCY_MISSING", missing });
  }

  function createContext(options = {}) {
    ensureDependencies();
    const dataSource = options.dataSource?.scenario ? options.dataSource : dependencies.DataAdapter.createSyntheticStudy(options.fixtureOptions);
    const scenario = dependencies.Admission.freeze(dependencies.Contract.normalizeScenario(dataSource.scenario));
    const identity = dependencies.Contract.identityBundle(scenario);
    const baselineRecord = dependencies.ScenarioLab.baseline(scenario);
    const evaluationCache = new Map();
    let evaluateCount = 0;

    function evaluate(record, solveOptions = {}) {
      const activeRecord = record?.scenario ? record : dependencies.ScenarioLab.baseline(record || scenario);
      const cacheKey = dependencies.Admission.contextKey(activeRecord, solveOptions);
      if (evaluationCache.has(cacheKey)) return dependencies.Admission.admit(activeRecord, evaluationCache.get(cacheKey));
      const started = now();
      const plan = dependencies.Solver.solveNetwork(activeRecord.scenario, { maxOrders: 500, maxTripsPerWave: 8, ...solveOptions });
      if (!["BEST_FOUND", "PARTIAL"].includes(plan.status)) throw Object.assign(new Error(`Network evaluation stopped with ${plan.status}`), { code: plan.reasonCode || "DESIGN_EVALUATION_FAILED", plan });
      const verificationStarted=now();
      const verification = dependencies.Solver.verifyNetworkPlan(activeRecord.scenario, plan);
      if (verification.status !== "PASS") throw Object.assign(new Error("Network verification failed"), { code: "DESIGN_NETWORK_VERIFICATION_FAILED", issues: verification.issues });
      const accounting = dependencies.Accounting.computeAccounting(activeRecord.scenario, plan, activeRecord.scenario.assumptions.accountingOptions || {});
      const accountingVerification = dependencies.Accounting.verifyAccounting(activeRecord.scenario, plan, accounting);
      if (accountingVerification.status !== "PASS") throw Object.assign(new Error("Accounting verification failed"), { code: "DESIGN_ACCOUNTING_VERIFICATION_FAILED", issues: accountingVerification.issues });
      const eligibility = dependencies.Accounting.candidateEligibility(accounting);
      if (!eligibility.eligible) throw Object.assign(new Error("Candidate accounting is incomplete"), { code: "DESIGN_ACCOUNTING_INELIGIBLE", reasons: eligibility.reasons });
      const visual = dependencies.Visualization.buildModel(activeRecord.scenario, plan);
      const visualVerification = dependencies.Visualization.verifySources(visual);
      if (visualVerification.status !== "PASS") throw Object.assign(new Error("Visual evidence sources failed verification"), { code: "DESIGN_VISUAL_SOURCE_FAILED", issues: visualVerification.issues });
      const result = {
        schemaVersion: "stct-design-evaluation-v1.9-p4",
        scenarioId: activeRecord.scenarioId,
        networkInputHash: activeRecord.inputHash,
        changeHash: activeRecord.changeHash,
        plan,
        verification,
        accounting,
        accountingVerification,
        eligibility,
        visual,
        evaluationMs: Math.round((now() - started) * 10) / 10,
        engineBoundary: { requested: plan.engine.requested, used: plan.engine.used, actualOrtoolsRun: plan.engine.actualOrtoolsRun, publicRoutingCalls: plan.engine.publicRoutingCalls, optimality: plan.objectiveDisclosure.optimality },
        authority: { canonical: dependencies.Contract.VERSION, networkVerifier: dependencies.Solver.VERSION, accounting: dependencies.Accounting.VERSION, visualization: dependencies.Visualization.VERSION },
      };
      result.evaluationHash = dependencies.Contract.hashArtifact({ scenarioId: result.scenarioId, networkInputHash: result.networkInputHash, planHash: plan.networkPlanHash, accountingHash: accounting.accountingHash, visualHash: visual.visualHash });
      const admitted = dependencies.Admission.freeze({...dependencies.Admission.admit(activeRecord, result),verificationMs:now()-verificationStarted});
      evaluationCache.set(cacheKey, admitted);
      evaluateCount += 1;
      return admitted;
    }

    const baselineEvaluation = evaluate(baselineRecord);
    const contextProjection = { schemaVersion: SCHEMA_VERSION, contextId: `DESIGN-CONTEXT-${identity.networkInputHash.slice(-12).toUpperCase()}`, dataClassification: dataSource.dataClassification, sourceType: dataSource.sourceType, sourceRefs: [dataSource.sourceRef], networkInputHash: identity.networkInputHash, routingContextHash: identity.routingContextHash, providerProvenance: clone(scenario.routingContext), baselinePlanHash: baselineEvaluation.plan.networkPlanHash, accountingHash: baselineEvaluation.accounting.accountingHash };
    const contextHash = dependencies.Contract.hashArtifact(contextProjection);
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      contextId: contextProjection.contextId,
      contextHash,
      dataClassification: dataSource.dataClassification,
      sourceType: dataSource.sourceType,
      sourceRefs: clone(contextProjection.sourceRefs),
      dataSource: clone(dataSource),
      scenario,
      networkScenario: scenario,
      identity,
      networkInputHash: identity.networkInputHash,
      routingContextHash: identity.routingContextHash,
      providerProvenance: clone(scenario.routingContext),
      baselinePlan: clone(baselineEvaluation.plan),
      baselinePlanHash: baselineEvaluation.plan.networkPlanHash,
      verifierResult: clone(baselineEvaluation.verification),
      accountingLedger: clone(baselineEvaluation.accounting),
      accountingHash: baselineEvaluation.accounting.accountingHash,
      studyStore: "OWNED_BY_DESIGN_STUDY_STORE",
      scenarioHistory: [{ scenarioId: baselineRecord.scenarioId, inputHash: baselineRecord.inputHash, type: baselineRecord.type }],
      operationalValidationResults: [],
      capabilities: Object.freeze(["NETWORK_CONTRACT", "SCENARIO_LAB", "LOCAL_HEURISTIC_NETWORK_PLAN", "INDEPENDENT_NETWORK_VERIFIER", "VERIFIED_ACCOUNTING", "NETWORK_VISUALIZATION", "NO_WEBGL_EQUIVALENT"]),
      boundaries: Object.freeze({ localStrategicDemo: true, syntheticOrAnonymizedData: true, verifiedLocalHeuristicPlan: true, networkOrtoolsProbeOnly: true, facilityLocationSolver: "MVP1_LOCAL_OR_TOOLS_CP_SAT", facilityLocationScope: "FINITE_CANDIDATE_P1_P2_P3", liveOperationsFeed: false, p5SharedPlatformServices: "LOCAL_IMPLEMENTED", p6OperationalValidationBridge: "LOCAL_IMPLEMENTED" }),
      Contract: dependencies.Contract,
      Solver: dependencies.Solver,
      Accounting: dependencies.Accounting,
      ScenarioLab: dependencies.ScenarioLab,
      Visualization: dependencies.Visualization,
      evaluate,
      admit: dependencies.Admission.admit,
      diagnostics() { return { schemaVersion: SCHEMA_VERSION, contextId: contextProjection.contextId, contextHash, cacheSize: evaluationCache.size, evaluateCount, externalRequests: 0, publicRoutingCalls: 0, authorities: { canonical: "network-contract-v18", routing: "network-solver-v18", verifier: "network-solver-v18", cost: "network-accounting-v18", visualization: "network-visualization-v18" }, boundaries: clone(this.boundaries) }; },
    });
  }

  return Object.freeze({ SCHEMA_VERSION, createContext });
});
