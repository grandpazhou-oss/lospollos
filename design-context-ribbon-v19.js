(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) { root.STCTPlatformV19 = root.STCTPlatformV19 || {}; root.STCTPlatformV19.designContextRibbon = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function project(store) { const source = store.snapshot(); const depots = new Set(source.activeRecord.scenario.depots.map((row) => row.depotId)); const selectedDepotId = depots.has(source.viewState.selectedDepotId) ? source.viewState.selectedDepotId : ""; return { schemaVersion: "stct-design-context-ribbon-v1.9-p4", studyId: source.studyId, studyHash: source.studyHash, lifecycle: source.lifecycle, baselineScenarioId: source.baselineScenarioId, scenarioId: source.activeScenarioId, inputHash: source.activeInputHash, demandPeriod: source.demandPeriod, selection: { depotId: selectedDepotId, facilityId: selectedDepotId, zoneId: selectedDepotId.replace(/^D/, "Z"), portfolioId: source.viewState.selectedPortfolioId }, staleSelectionsCleared: selectedDepotId !== source.viewState.selectedDepotId, provider: { providerId: source.activeRecord.scenario.routingContext.providerId, matrixVersion: source.activeRecord.scenario.routingContext.matrixVersion }, dataClassification: source.dataSource.dataClassification, sourceType: source.dataSource.sourceType, evaluation: source.evaluation ? { verification: source.evaluation.verification.status, accounting: source.evaluation.accountingVerification.status, engine: source.evaluation.engineBoundary.used, optimality: source.evaluation.engineBoundary.optimality } : null, strategicNotOperational: true } }
  return Object.freeze({ project });
});
