(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const twin = root?.STCTV16?.executionTwin || (typeof require === "function" ? require("./execution-twin-v16.js") : null);
  const stores = root?.STCTV16?.executionStore || (typeof require === "function" ? require("./execution-store-v16.js") : null);
  const api = factory(integrity, twin, stores);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV16 = root.STCTV16 || { version: "1.6.0" }; root.STCTV16.executionProfiles = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash, Twin, Stores) {
  "use strict";
  if (!IntegrityHash?.hashValue || !Twin || !Stores) throw new Error("Execution Profiles v1.6 dependencies are missing.");
  const VERSION = "stct-execution-profiles-v1.6";
  const SETTINGS = Object.freeze({ ON_TIME: { startDelay: 0, travelStep: 2, dwell: 5 }, URBAN_CONGESTION: { startDelay: 0, travelStep: 5, dwell: 5 }, WAREHOUSE_DELAY: { startDelay: 25, travelStep: 2, dwell: 5 }, HIGH_DWELL: { startDelay: 0, travelStep: 2, dwell: 18 }, OFF_ROUTE: { startDelay: 0, travelStep: 3, dwell: 5, offRoute: true }, VEHICLE_BREAKDOWN: { startDelay: 0, travelStep: 3, dwell: 5, breakdown: true }, MIXED_RISK: { startDelay: 15, travelStep: 5, dwell: 15, offRoute: true, breakdown: true } });
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  function generate(run, plan, options = {}) {
    const setting = SETTINGS[run.executionProfile]; if (!setting) throw Object.assign(new Error(`Unsupported execution profile: ${run.executionProfile}`), { code: "EXECUTION_PROFILE_INVALID" });
    let sequence = 0; const events = []; const push = (spec) => { sequence += 1; const event = Twin.createEvent(run, { eventId: `${run.executionRunId}-E${String(sequence).padStart(5, "0")}`, sequence, executionRevision: run.revision, source: "LOCAL_SIMULATION", payload: { planRevision: run.revision, profile: run.executionProfile, ...(spec.payload || {}) }, ...spec }); events.push(event); return event; };
    let cursor = run.logicalStartMinute; push({ eventType: "RUN_RELEASED", logicalTime: cursor });
    for (const route of plan.routes || []) {
      cursor += setting.startDelay; push({ eventType: "ROUTE_ACCEPTED", logicalTime: cursor, routeId: route.routeId, vehicleId: route.vehicleId }); push({ eventType: "VEHICLE_DEPARTED", logicalTime: cursor, routeId: route.routeId, vehicleId: route.vehicleId });
      const geometry = route.geometry || route.routeGeometry || options.geometryByRoute?.[route.routeId] || [[0, 0], [0.001, 0.001]]; const edgeIds = route.edgeIds || [];
      const samples = Math.max(3, Math.min(9, geometry.length));
      for (let index = 1; index <= samples; index += 1) { cursor += setting.travelStep; const progress = index / samples; const coordinate = Twin.interpolateGeometry(geometry, progress); push({ eventType: "POSITION_RECORDED", logicalTime: cursor, routeId: route.routeId, vehicleId: route.vehicleId, coordinate, roadEdgeId: edgeIds[Math.min(edgeIds.length - 1, Math.floor(progress * edgeIds.length))] || "", payload: { geometrySource: route.estimated ? "ESTIMATED_GEOMETRY" : "ROAD_ROUTE_RESULT", roadMatched: route.estimated !== true, progress } }); if (setting.offRoute && index === Math.ceil(samples / 2)) { push({ eventType: "OFF_ROUTE_DETECTED", logicalTime: cursor, routeId: route.routeId, vehicleId: route.vehicleId, coordinate: [coordinate[0] + 0.001, coordinate[1] + 0.001], payload: { distanceMeters: 140, confidence: "LOW", simulationOnly: true } }); cursor += 2; push({ eventType: "ROUTE_REJOINED", logicalTime: cursor, routeId: route.routeId, vehicleId: route.vehicleId, coordinate, payload: { confidence: "HIGH", simulationOnly: true } }); } }
      let breakdownHandled = false;
      for (const orderId of route.orderIds || []) {
        if (setting.breakdown && !breakdownHandled && (route.orderIds || []).length > 1) { push({ eventType: "VEHICLE_BREAKDOWN", logicalTime: cursor, routeId: route.routeId, vehicleId: route.vehicleId, orderId, payload: { simulationOnly: true, reason: "SYNTHETIC_BREAKDOWN" } }); breakdownHandled = true; break; }
        cursor += setting.travelStep; push({ eventType: "STOP_ARRIVED", logicalTime: cursor, routeId: route.routeId, vehicleId: route.vehicleId, orderId }); push({ eventType: "SERVICE_STARTED", logicalTime: cursor, routeId: route.routeId, vehicleId: route.vehicleId, orderId }); cursor += setting.dwell; push({ eventType: "SERVICE_COMPLETED", logicalTime: cursor, routeId: route.routeId, vehicleId: route.vehicleId, orderId, ackId: `ACK-${orderId}` });
      }
    }
    cursor += 1; push({ eventType: "RUN_COMPLETED", logicalTime: cursor });
    return { schemaVersion: "stct-execution-profile-stream-v1.6", run: clone(run), events, eventStreamHash: IntegrityHash.hashValue(events.map((event) => event.eventHash)), deterministicKey: IntegrityHash.hashValue({ planHash: run.planHash, profile: run.executionProfile, seed: run.simulationSeed }), label: "Execution Twin Simulation", actualLabel: "Simulated Actual", dataClassification: "SYNTHETIC" };
  }
  function createController(options = {}) {
    const run = clone(options.run); const plan = clone(options.plan); const stream = options.stream || generate(run, plan, options); const store = Stores.createStore({ run, plan, noWebGL: options.noWebGL, clock: options.clock }); let pointer = 0; let paused = true; let speed = 1; const archives = [];
    function release() { if (pointer) return { status: "ALREADY_RELEASED", state: store.snapshot() }; const result = store.append(stream.events[pointer++]); paused = true; return result; }
    function play() { if (!pointer) release(); paused = false; return snapshot(); }
    function pause() { paused = true; return snapshot(); }
    function step() { if (paused) return { status: "PAUSED_NO_EVENT", state: store.snapshot() }; if (pointer >= stream.events.length) return { status: "END_OF_STREAM", state: store.snapshot() }; return store.append(stream.events[pointer++]); }
    function resume() { paused = false; return snapshot(); }
    function setSpeed(value) { speed = Math.max(0.25, Math.min(16, Number(value) || 1)); return snapshot(); }
    function toggleOffline(enabled) { const state = store.snapshot(); const event = Twin.createEvent(run, { eventId: `${run.executionRunId}-MANUAL-${state.acceptedEvents.length + 1}`, sequence: state.acceptedEvents.length + 1, executionRevision: run.revision, eventType: enabled ? "NETWORK_OFFLINE" : "NETWORK_RESTORED", logicalTime: state.latestLogicalTime, source: "LOCAL_SIMULATION", payload: { planRevision: run.revision, manuallyInjected: true } }); return store.append(event); }
    function reset(confirm) { if (confirm !== true) throw Object.assign(new Error("Reset requires explicit confirmation and export preservation."), { code: "EXECUTION_RESET_CONFIRMATION_REQUIRED" }); const archive = store.exportState(); archives.push(archive); pointer = 0; paused = true; return { status: "RESET_PREPARED", archivedExportHash: archive.exportHash, archives: archives.length }; }
    function snapshot() { return { status: paused ? "PAUSED" : "RUNNING", pointer, speed, noWebGL: options.noWebGL === true, state: store.snapshot(), archives: archives.map((row) => row.exportHash) }; }
    return { release, play, pause, step, resume, setSpeed, toggleOffline, reset, snapshot, store, stream };
  }
  return { VERSION, SETTINGS, generate, createController };
});
