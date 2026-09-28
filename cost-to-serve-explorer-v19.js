(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) { root.STCTPlatformV19 = root.STCTPlatformV19 || {}; root.STCTPlatformV19.costToServeExplorer = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const csv = (value) => { const source = String(value ?? ""); const safe = /^[\t\r\n ]*[=+\-@]/.test(source) ? `'${source}` : source; return `"${safe.replaceAll('"', '""')}"`; };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const COMPONENT_LABELS={zh:['车辆固定费','趟次固定费','里程费用','时间费用','通行费','空驶调位','月台作业','月台等待','再装载','中转','仓库处理','加班','未分配罚金','衔接失败'],ja:['車両固定費','運行固定費','走行費用','時間費用','通行料','空車回送','ドック作業','ドック待機','再積載','積替え','倉庫作業','時間外','未配分ペナルティ','接続失敗']};
  function componentLabel(name,index,locale){return COMPONENT_LABELS[locale]?.[index]||name.replace(/([A-Z])/g,' $1');}
  function project(store, filters = {}) {
    const source = store.snapshot();
    const ledger = source.evaluation?.accounting;
    if (!ledger) return { schemaVersion: "stct-cost-to-serve-explorer-v1.9-p4", status: "EVALUATION_REQUIRED", components: [], allocations: {} };
    const components = store.context.Accounting.COST_COMPONENTS.map((name,index) => { const present = Object.prototype.hasOwnProperty.call(ledger.cost.components, name); return { name, label:componentLabel(name,index,filters.locale||'en'), value: present ? ledger.cost.components[name] : null, present, status: present ? "VERIFIED_COMPONENT" : "MISSING_EXCLUDED_FROM_TOTAL" }; });
    const visibleTotal = components.filter((row) => row.present).reduce((sum, row) => sum + Number(row.value || 0), 0);
    const allocationScope = ["order", "zone", "depot", "trip", "route", "wave", "vehicleType"].includes(filters.scope) ? filters.scope : "depot";
    const routeAllocations = (ledger.allocations.trip || []).map((row) => ({ ...row, routeId: row.tripId || row.key, allocationBoundary: "TRIP_IS_THE_VERIFIED_ROUTE_COST_UNIT" }));
    const allocationRows = (allocationScope === "route" ? routeAllocations : ledger.allocations[allocationScope] || []).map(row => {
      const entityId = String(allocationScope === "order" ? row.orderId : row.key || row.routeId || "");
      const scenario = source.activeRecord.scenario;
      const collections = { depot: scenario.depots, zone: scenario.zones, order: scenario.orders, vehicleType: scenario.vehicleTypes, trip: source.evaluation.plan.trip.trips, route: source.evaluation.plan.trip.trips, wave: source.evaluation.plan.waves.waves };
      const idField = allocationScope === "route" ? "tripId" : `${allocationScope}Id`;
      const entity = (collections[allocationScope] || []).find(item => item[idField] === entityId);
      return { ...row, entityType: allocationScope, entityId, entityLabel: entity?.name || entityId, nameKnown: Boolean(entity?.name), amount: row.amount };
    });
    return {
      schemaVersion: "stct-cost-to-serve-explorer-v1.9-p4", status: source.evaluation.accountingVerification.status,
      studyHash: source.studyHash, networkInputHash: source.activeInputHash, planHash: source.evaluation.plan.networkPlanHash, accountingHash: ledger.accountingHash,
      total: ledger.cost.total, visibleComponentTotal: Math.round(visibleTotal * 1000) / 1000, totalMatchesVisibleComponents: Math.abs(visibleTotal - ledger.cost.total) < .001,
      currency: ledger.cost.currency || ledger.assumptions.currency, period: "MODEL_RUN_NOT_ANNUALIZED", displayHorizon: source.demandPeriod, costBasis: "MODEL_RUN", costPeriod: source.activeRecord.scenario.assumptions?.costPeriod || "UNSPECIFIED", observationPeriod: source.activeRecord.scenario.assumptions?.observationPeriod || "UNSPECIFIED", normalization: "NONE", roundingPolicy: "COMPONENTS_ROUNDED_TO_0.001; DISPLAY_ROUNDING_DOES_NOT_CHANGE_LEDGER",
      components,
      carbon: { totalKg: ledger.carbon.totalKg, components: store.context.Accounting.CARBON_COMPONENTS.map((name) => ({ name, value: Object.prototype.hasOwnProperty.call(ledger.carbon.components, name) ? ledger.carbon.components[name] : null, present: Object.prototype.hasOwnProperty.call(ledger.carbon.components, name) })), factorSource: ledger.carbon.factorSource, disclaimer: ledger.carbon.disclaimer || "Scenario estimate only; not certified ESG accounting." },
      serviceLevel: ledger.metrics.serviceLevel,
      allocations: { ...ledger.allocations, route: routeAllocations }, allocation: { scope: allocationScope, method: allocationScope === "route" ? `${ledger.cost.allocationMethod}; TRIP_AS_ROUTE_UNIT` : ledger.cost.allocationMethod, rows: allocationRows, fabricatedOrderCost: false },
      assumptions: ledger.assumptions, formula: ledger.trustLab.costFormula, filters: { scope: allocationScope }, comparisonSemantics: source.activeInputHash === source.baselineInputHash ? "SAME_INPUT" : "SCENARIO_CHANGED",
      sourceAuthority: "network-accounting-v18",
    };
  }
  function resetFilters() { return { scope: "depot" }; }
  function toJson(store, filters = {}) { return `${JSON.stringify(project(store, filters), null, 2)}\n`; }
  function toCsv(store, filters = {}) { const value = project(store, filters); return `component,value,status\n${value.components.map((row) => [row.name, row.value ?? "MISSING", row.status].map(csv).join(",")).join("\n")}\n`; }
  function toPrintableHtml(store, filters = {}) { const value = project(store, filters); return `<!doctype html><html><head><meta charset="utf-8"><title>Cost to Serve</title></head><body><h1>Cost to Serve</h1><p>${escapeHtml(value.currency)} ${escapeHtml(value.total)} · ${escapeHtml(value.period)}</p><table><thead><tr><th>Component</th><th>Value</th><th>Status</th></tr></thead><tbody>${value.components.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.value ?? "MISSING")}</td><td>${escapeHtml(row.status)}</td></tr>`).join("")}</tbody></table><p>${escapeHtml(value.carbon.disclaimer)}</p></body></html>`; }
  return Object.freeze({ project, resetFilters, toJson, toCsv, toPrintableHtml });
});
