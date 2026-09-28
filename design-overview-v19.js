(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) { root.STCTPlatformV19 = root.STCTPlatformV19 || {}; root.STCTPlatformV19.designOverview = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const SCHEMA_VERSION = "stct-design-overview-projection-v1.9-p4";
  function project(store) {
    const source = store.snapshot();
    const scenario = source.activeRecord.scenario;
    const ledger = source.evaluation?.accounting;
    const records = source.history;
    const ready = source.lifecycle === "READY_FOR_REVIEW" || source.lifecycle === "BASELINED";
    return {
      schemaVersion: SCHEMA_VERSION,
      strategicTimeHorizon: { mode: scenario.planningHorizon.mode, demandPeriod: source.demandPeriod, timezone: scenario.planningHorizon.timezone },
      activeStudy: { studyId: source.studyId, studyHash: source.studyHash, lifecycle: source.lifecycle, scenarioId: source.activeScenarioId, inputHash: source.activeInputHash },
      currentFacilities: { depots: scenario.depots.length, docks: scenario.docks.length, roles: scenario.depots.reduce((rows, depot) => { rows[depot.role] = (rows[depot.role] || 0) + 1; return rows; }, {}) },
      baseline: ledger ? { cost: ledger.cost.total, currency: ledger.cost.currency || ledger.assumptions.currency, service: ledger.metrics.serviceLevel, carbonKg: ledger.carbon.totalKg, accountingHash: ledger.accountingHash, verified: source.evaluation.accountingVerification.status } : null,
      candidatePortfolios: records.filter((record) => record.type !== "BASELINE").map((record) => ({ scenarioId: record.scenarioId, type: record.type, inputHash: record.inputHash, status: record.scenarioId === source.activeScenarioId ? source.lifecycle : "SAVED" })),
      operationalValidation: { status: source.validations.length ? source.validations.at(-1).status : "AVAILABLE_NO_RESULTS", results: source.validations.length, boundary: "P6_OPERATIONAL_VALIDATION_BRIDGE_ACTIVE" },
      dataGaps: ["LAND_AVAILABILITY_NOT_CONNECTED", "REAL_ESTATE_COST_NOT_CONNECTED", "ROAD_ECONOMIC_MATRIX_USES_SYNTHETIC_FIXTURE", "INVESTMENT_APPROVAL_OUT_OF_SCOPE"],
      nextAction: ready ? { action: "CREATE_DEMAND_SCENARIO", target: "/design/demand-growth" } : { action: "EVALUATE_ACTIVE_SCENARIO", target: "/design/network-scenarios" },
      firstScan: ["ACTIVE_STUDY", "DEMAND_PERIOD", "FACILITIES", "COST_SERVICE_BASELINE", "CANDIDATE_PORTFOLIOS", "OPERATIONAL_VALIDATION", "DATA_GAPS", "NEXT_ACTION"],
      excludesRealTimeOperationalStatus: true,
      sourceAuthorities: ["DesignStudyStore", "network-accounting-v18", "network-contract-v18"],
    };
  }
  return Object.freeze({ SCHEMA_VERSION, project });
});
