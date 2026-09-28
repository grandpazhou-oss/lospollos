(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) { root.STCTPlatformV19 = root.STCTPlatformV19 || {}; root.STCTPlatformV19.designActionCenter = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function project(store, filters = {}) {
    const source = store.snapshot();
    const items = [];
    const evaluation = source.evaluation;
    const scenario = source.activeRecord.scenario;
    const push = (item) => items.push({ schemaVersion: "stct-design-action-item-v1.9-p4", state: "OPEN", ...item, sourceStudyHash: source.studyHash, sourceInputHash: source.activeInputHash });
    if (!source.baselineResultRef) push({ id: "ACTION-BASELINE", severity: "CRITICAL", category: "BASELINE", title: "Verified baseline is missing", action: "OPEN_SCENARIOS", target: "/design/network-scenarios", sourceHash: source.baselineInputHash });
    if (source.lifecycle === "SCENARIO_DIRTY" || source.lifecycle === "STALE") items.push({ id: "ACTION-EVALUATE", severity: "HIGH", state: "OPEN", category: "STUDY", title: "Evaluate changed-input scenario", action: "EVALUATE", target: "/design/network-scenarios", sourceHash: source.activeInputHash });
    if (source.lifecycle === "STALE") push({ id: "ACTION-STALE-SCENARIO", severity: "HIGH", category: "SCENARIO", title: "Scenario evaluation is stale", action: "OPEN_SCENARIOS", target: "/design/network-scenarios", sourceHash: source.activeInputHash });
    if (evaluation && evaluation.verification.status !== "PASS") push({ id: "ACTION-UNVERIFIED-SCENARIO", severity: "CRITICAL", category: "VERIFICATION", title: "Scenario result is not independently verified", action: "OPEN_SCENARIOS", target: "/design/network-scenarios", sourceHash: evaluation.evaluationHash });
    const missingCost = evaluation ? store.context.Accounting.COST_COMPONENTS.filter((name) => !Object.prototype.hasOwnProperty.call(evaluation.accounting.cost.components, name)) : [];
    if (missingCost.length) push({ id: "ACTION-COST-COMPONENT", severity: "HIGH", category: "ACCOUNTING", title: "Cost component is missing", action: "OPEN_COST", target: "/design/cost-to-serve", sourceHash: evaluation.accounting.accountingHash, detail: missingCost });
    const capacityRows = evaluation?.visual.layers.capacityStress || [];
    if (capacityRows.some((row) => Number(row.properties?.utilization || 0) >= .8)) push({ id: "ACTION-CAPACITY", severity: "HIGH", category: "CAPACITY", title: "Capacity bottleneck requires review", action: "OPEN_CAPACITY", target: "/design/fleet-capacity", sourceHash: evaluation.evaluationHash });
    if (!scenario.routingContext?.providerId || !scenario.routingContext?.matrixVersion) push({ id: "ACTION-ROUTING", severity: "CRITICAL", category: "PROVENANCE", title: "Routing or matrix provenance is missing", action: "OPEN_BASELINE", target: "/design/overview", sourceHash: source.activeInputHash });
    if (!source.validations.length) items.push({ id: "ACTION-VALIDATION", severity: "MEDIUM", state: "OPEN", category: "VALIDATION", title: "Operational validation is not connected", action: "OPEN_VALIDATION", target: "/design/operational-validation", sourceHash: source.studyHash });
    ["LAND_AVAILABILITY", "REAL_ESTATE_COST"].forEach((gap) => items.push({ id: `ACTION-${gap}`, severity: "LOW", state: "OPEN", category: "DATA_GAP", title: `${gap.replaceAll("_", " ")} not connected`, action: "OPEN_READINESS", target: "/design/facility-location", sourceHash: source.activeInputHash }));
    if (source.lifecycle === "BASELINED" || source.lifecycle === "READY_FOR_REVIEW") items.push({ id: "ACTION-DEMAND", severity: "MEDIUM", state: "OPEN", category: "SCENARIO", title: "Create a demand growth scenario", action: "OPEN_DEMAND", target: "/design/demand-growth", sourceHash: source.activeInputHash });
    const search = String(filters.search || "").trim().toLowerCase();
    const filtered = items.filter((item) => (!filters.category || filters.category === "ALL" || item.category === filters.category) && (!search || `${item.title} ${item.action} ${item.category}`.toLowerCase().includes(search)));
    return { schemaVersion: "stct-design-action-center-v1.9-p4", items: filtered, total: items.length, next: filtered[0] || null, categories: [...new Set(items.map((item) => item.category))], source: "RULE_BASED_STUDY_STATE", commandActionsCalled: false, aiScore: false };
  }
  return Object.freeze({ project });
});
