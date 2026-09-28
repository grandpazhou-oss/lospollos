(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) { root.STCTPlatformV19 = root.STCTPlatformV19 || {}; root.STCTPlatformV19.facilityLocationReadiness = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const csv = (value) => { const source = String(value ?? ""); const safe = /^[\t\r\n ]*[=+\-@]/.test(source) ? `'${source}` : source; return `"${safe.replaceAll('"', '""')}"`; };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  function project(store) {
    const source = store.snapshot();
    const scenario = source.activeRecord.scenario;
    const volume = scenario.orders.reduce((sum, order) => sum + order.demand.volume, 0);
    const weighted = scenario.orders.reduce((sum, order) => [sum[0] + order.coordinate[0] * order.demand.volume, sum[1] + order.coordinate[1] * order.demand.volume], [0, 0]);
    const cog = volume ? [weighted[0] / volume, weighted[1] / volume] : null;
    const prerequisites = [
      { id: "DEMAND_COORDINATES", status: scenario.orders.every((order) => Array.isArray(order.coordinate)) ? "READY" : "MISSING", evidence: `${scenario.orders.length} canonical orders` },
      { id: "EXISTING_FACILITY_COORDINATES", status: scenario.depots.every((depot) => Array.isArray(depot.coordinate)) ? "READY" : "MISSING", evidence: `${scenario.depots.length} existing depots` },
      { id: "CANDIDATE_SITES", status: "NOT_CONNECTED", evidence: "No candidate-site dataset loaded" },
      { id: "CAPACITY", status: scenario.depots.every((depot) => depot.capacity) ? "READY" : "MISSING", evidence: "Canonical depot capacity" },
      { id: "ROUTING_PROVIDER", status: scenario.routingContext.providerId ? "READY" : "MISSING", evidence: scenario.routingContext.providerId || "MISSING" },
      { id: "ROAD_ECONOMIC_MATRIX", status: "SYNTHETIC_ONLY", evidence: scenario.routingContext.matrixVersion },
      { id: "COST_PERIOD_UNIT", status: "PARTIAL", evidence: "Scenario accounting available; property cost missing" },
      { id: "OPERATIONAL_VALIDATION", status: source.validations.length ? "READY" : "NOT_CONNECTED", evidence: `${source.validations.length} read-only results` },
      { id: "LAND_AVAILABILITY", status: "NOT_CONNECTED", evidence: "No land-feasibility source" },
      { id: "REAL_ESTATE_COST", status: "NOT_CONNECTED", evidence: "No property cost source" },
      { id: "INVESTMENT_APPROVAL", status: "OUT_OF_SCOPE", evidence: "Governance decision, not model output" },
    ];
    const ready = prerequisites.filter((row) => row.status === "READY").length;
    return {
      schemaVersion: "stct-facility-location-readiness-v1.9-p4",
      status: "READINESS_ONLY",
      solverStatus: "NOT_STARTED",
      centerOfGravity: { coordinate: cog, role: "DIAGNOSTIC_REFERENCE_ONLY", finalRealEstateRecommendation: false, roadEconomicFact: false },
      currentFacilities: scenario.depots.map((depot) => ({ depotId: depot.depotId, role: depot.role, coordinate: depot.coordinate })),
      prerequisites,
      readinessScore: { ready, total: prerequisites.length, percentage: Math.round(ready / prerequisites.length * 100), formula: "READY_PREREQUISITES / ALL_PREREQUISITES; PARTIAL_AND_SYNTHETIC_ONLY_ARE_NOT_READY" },
      prohibitedClaims: ["FINAL_REAL_ESTATE", "NEAREST_WAREHOUSE_OPTIMUM", "HAVERSINE_ROAD_ECONOMICS", "INVESTMENT_APPROVED", "LAND_AVAILABLE"],
      disclosures: {
        facilityLocationSolver: "NOT STARTED",
        nearestWarehouse: "Nearest Warehouse is not Facility Location optimization.",
        centerOfGravity: "Center of Gravity is a candidate ideal point, not real property.",
        haversine: "Haversine is preview or estimated distance, not road economics.",
      },
      nextGate: "FACILITY_LOCATION_SOLVER_SEPARATE_GATE",
      futureOwnerGate: "FACILITY_LOCATION_SOLVER_GATES_AFTER_P4",
      links: ["/platform/data", "/design/network-scenarios", "/design/cost-to-serve"],
      notesPolicy: "RAW_NORMALIZED_STORAGE; ESCAPE_AT_RENDER_ONLY",
      primaryAction: null,
    };
  }
  function toJson(store) { return `${JSON.stringify(project(store), null, 2)}\n`; }
  function toCsv(store) { return `prerequisite,status,evidence\n${project(store).prerequisites.map((row) => [row.id, row.status, row.evidence].map(csv).join(",")).join("\n")}\n`; }
  function toPrintableHtml(store, note = "") { const value = project(store); return `<!doctype html><html><head><meta charset="utf-8"><title>Facility Location Readiness</title></head><body><h1>Facility Location Readiness</h1><p>${escapeHtml(String(note ?? "").normalize("NFC"))}</p><p>${escapeHtml(value.disclosures.facilityLocationSolver)} · ${value.readinessScore.ready}/${value.readinessScore.total}</p><table><thead><tr><th>Prerequisite</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${value.prerequisites.map((row) => `<tr><td>${escapeHtml(row.id)}</td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.evidence)}</td></tr>`).join("")}</tbody></table></body></html>`; }
  return Object.freeze({ project, toJson, toCsv, toPrintableHtml });
});
