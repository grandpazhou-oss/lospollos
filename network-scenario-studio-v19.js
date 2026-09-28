(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) { root.STCTPlatformV19 = root.STCTPlatformV19 || {}; root.STCTPlatformV19.networkScenarioStudio = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const deepFreeze = (value) => { if (!value || typeof value !== "object" || Object.isFrozen(value)) return value; Object.values(value).forEach(deepFreeze); return Object.freeze(value); };
  function project(store) {
    const source = store.snapshot();
    const scenario = source.activeRecord.scenario;
    const templates = [
      { id: "DEMAND_10", type: "DEMAND_PEAK", payload: { factor: 1.1 } }, { id: "DEMAND_25", type: "DEMAND_PEAK", payload: { factor: 1.25 } }, { id: "DEMAND_50", type: "DEMAND_PEAK", payload: { factor: 1.5 } },
      { id: "REGIONAL_DEMAND_SHIFT", type: "DEMAND_PEAK", payload: { factor: 1.25, zoneId: scenario.zones[0]?.zoneId } },
      { id: "TIME_WINDOW_TIGHTEN", shock: "TIME_WINDOW_TIGHTEN", payload: { start: "10:00", end: "12:00" } },
      { id: "DEPOT_OUTAGE", shock: "DEPOT_OUTAGE", payload: { depotId: scenario.depots[0]?.depotId } }, { id: "DOCK_FAILURE", shock: "DOCK_FAILURE", payload: { depotId: scenario.depots[0]?.depotId } },
      { id: "FLEET_MIX", type: "FLEET_MIX_CHANGE", payload: { count: 2 } }, { id: "ROAD_CLOSURE", type: "ROAD_CLOSURE", payload: { closureId: `DESIGN-CLOSURE-${source.revision + 1}`, from: "FIXTURE-A", to: "FIXTURE-B" } },
      { id: "SHIFT_EXTENSION", type: "SHIFT_EXTENSION", payload: { minutes: 120 } }, { id: "VEHICLE_TYPE_SHORTAGE", type: "VEHICLE_TYPE_SHORTAGE", payload: { vehicleTypeId: scenario.vehicleTypes[0]?.vehicleTypeId, count: 1 } }, { id: "DRIVER_UNAVAILABLE", type: "DRIVER_UNAVAILABLE", payload: { driverId: scenario.drivers[0]?.driverId } },
      { id: "RELEASE_TIME_SHIFT", type: "RELEASE_TIME_SHIFT", payload: { minutes: 60 } }, { id: "CROSS_DOCK_ENABLE", type: "CROSS_DOCK_ENABLE", payload: { depotId: scenario.depots.at(-1)?.depotId } }, { id: "CROSS_DOCK_DISABLE", type: "CROSS_DOCK_INTERRUPTION", payload: { depotId: scenario.depots.find((depot) => depot.transferSupported)?.depotId } },
    ];
    return {
      schemaVersion: "stct-network-scenario-studio-v1.9-p4",
      activeScenarioId: source.activeScenarioId,
      lifecycle: source.lifecycle,
      cursor: source.cursor,
      canUndo: source.cursor > 0,
      canRedo: source.cursor < source.history.length - 1,
      supportedTypes: store.context.ScenarioLab.TYPES.filter((type) => type !== "BASELINE"),
      templates,
      scenarios: source.history.map((record) => ({ ...record, selected: record.scenarioId === source.activeScenarioId, dataClassification: source.dataSource.dataClassification, source: source.dataSource.sourceType, evaluationState: source.scenarioResultRefs.some((result) => result.networkInputHash === record.inputHash) ? "EVALUATED" : "DRAFT", comparisonWording: record.inputHash === source.baselineInputHash ? "SAME_INPUT_BASELINE" : "SCENARIO_CHANGED" })),
      evaluation: source.evaluation ? { evaluationHash: source.evaluation.evaluationHash, networkInputHash: source.evaluation.networkInputHash, verification: source.evaluation.verification.status, accountingVerification: source.evaluation.accountingVerification.status, optimality: source.evaluation.engineBoundary.optimality } : null,
      portfolio: source.scenarioResultRefs.map((result) => ({ ...result, comparisonWording: result.networkInputHash === source.baselineInputHash ? "SAME_INPUT_BASELINE" : "SCENARIO_CHANGED", comparableToActive: result.networkInputHash === source.activeInputHash })),
      observedFrontier: source.scenarioResultRefs.filter((result) => result.networkInputHash === source.activeInputHash),
      notesPolicy: "RAW_NORMALIZED_STORAGE; ESCAPE_AT_RENDER_ONLY",
      failureState: source.evaluationFailure || (source.lifecycle === "STALE" ? { code: "STALE_RESULT_REJECTED", inputHash: source.activeInputHash } : null),
      timeoutState: source.evaluationFailure?.code?.includes("TIMEOUT") ? source.evaluationFailure : null,
      sourceAuthority: "scenario-lab-v18",
    };
  }
  function create(store, templateId) { const template = project(store).templates.find((row) => row.id === templateId); if (!template || template.supported === false) throw Object.assign(new Error(template?.reason || "Unknown scenario template"), { code: "DESIGN_SCENARIO_TEMPLATE_UNAVAILABLE" }); return template.shock ? store.createShock(template.shock, template.payload) : store.createScenario(template.type, template.payload); }
  function exportPortfolio(store) { const payload = { schemaVersion: "stct-design-scenario-portfolio-v1.9-p4", mode: "READ_ONLY", study: store.exportReadOnly(), portfolio: project(store).portfolio }; payload.exportHash = store.context.Contract.hashArtifact(payload); return `${JSON.stringify(payload, null, 2)}\n`; }
  function importReadOnly(store, payload) { let value; try { value = typeof payload === "string" ? JSON.parse(payload) : payload; } catch (_error) { return { status: "FAIL", code: "DESIGN_SCENARIO_IMPORT_JSON_INVALID" }; } const copy = JSON.parse(JSON.stringify(value)); const hash = copy.exportHash; delete copy.exportHash; return hash && store.context.Contract.hashArtifact(copy) === hash ? deepFreeze({ status: "PASS", mode: "READ_ONLY", pack: JSON.parse(JSON.stringify(value)), sideEffects: { evaluationStarted: false, externalRequests: 0 } }) : { status: "FAIL", code: "DESIGN_SCENARIO_IMPORT_HASH_MISMATCH" }; }
  return Object.freeze({ project, create, exportPortfolio, importReadOnly });
});
