(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const tracksApi = root?.STCTV17?.fleetTracks || (typeof require === "function" ? require("./fleet-tracks-v17.js") : null);
  const api = factory(integrity, tracksApi);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV17 = root.STCTV17 || { version: "1.7.0" }; root.STCTV17.fleetReplay = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash, FleetTracks) {
  "use strict";
  if (!IntegrityHash?.hashValue || !FleetTracks?.build) throw new Error("Fleet Replay v1.7 dependencies are missing.");
  const VERSION = "stct-fleet-replay-v1.7";
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  function memoryStorage() { const values = new Map(); return { getItem: (key) => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; }

  function syntheticScenario(options = {}) {
    const vehicleCount = Number(options.vehicleCount || 20); const stopsPerVehicle = Number(options.stopsPerVehicle || 12); const positionsPerVehicle = Number(options.positionsPerVehicle || 24); const routes = []; const stops = []; const positions = []; const events = []; const alerts = [];
    for (let vehicleIndex = 0; vehicleIndex < vehicleCount; vehicleIndex += 1) {
      const vehicleId = `V${String(vehicleIndex + 1).padStart(2, "0")}`; const routeId = `R${String(vehicleIndex + 1).padStart(2, "0")}`; const orderIds = [];
      for (let stopIndex = 0; stopIndex < stopsPerVehicle; stopIndex += 1) { const orderId = `${routeId}-S${String(stopIndex + 1).padStart(2, "0")}`; orderIds.push(orderId); stops.push({ orderId, routeId, vehicleId, sequence: stopIndex + 1, logicalTime: 100 + stopIndex * 20 }); }
      const geometry = Array.from({ length: positionsPerVehicle }, (_, index) => [121.45 + vehicleIndex * 0.001 + index * 0.0002, 31.2 + vehicleIndex * 0.0005 + Math.sin(index / 4) * 0.0001]); routes.push({ routeId, vehicleId, revision: 1, orderIds, geometry });
      geometry.forEach((coordinate, index) => { const logicalTime = 100 + index * 10; const derivedTelemetryHash = IntegrityHash.hashValue({ vehicleId, routeId, logicalTime, coordinate }); const row = { vehicleId, routeId, routeRevision: 1, logicalTime, matchedCoordinate: coordinate, matchedEdgeId: `SYN-${vehicleIndex}-${index}`, offRoute: vehicleIndex % 7 === 0 && index > 16, matchConfidence: "HIGH", alertCount: vehicleIndex % 5 === 0 ? 1 : 0, derivedTelemetryHash, progress: index / (positionsPerVehicle - 1) }; positions.push(row); events.push({ eventId: `EV-${vehicleId}-${index}`, eventType: "POSITION_RECORDED", vehicleId, routeId, logicalTime, derivedTelemetryHash }); });
      if (vehicleIndex % 5 === 0) alerts.push({ alertId: `ALERT-${vehicleId}`, vehicleId, routeId, logicalTime: 270, severity: "HIGH" });
    }
    const scenario = { schemaVersion: "stct-synthetic-fleet-scenario-v1.7", dataClassification: "SYNTHETIC", liveFleetClaim: false, boundary: "SYNTHETIC_REPLAY_NOT_REAL_FLEET", routes, stops, positions, events, alerts, sharedClock: { start: 100, end: 100 + (positionsPerVehicle - 1) * 10, unit: "LOGICAL_SECONDS" }, scenarioHash: "" }; scenario.scenarioHash = IntegrityHash.hashValue({ ...scenario, scenarioHash: "" }); return scenario;
  }

  function createReplay(input = {}, options = {}) {
    const scenario = clone(input); const storage = options.storage || memoryStorage(); const storageKey = text(options.storageKey || "stct-fleet-replay-v17"); const tracks = FleetTracks.build(scenario.positions || []); const events = [...(scenario.events || [])].sort((a, b) => Number(a.logicalTime) - Number(b.logicalTime) || a.eventId.localeCompare(b.eventId, "en")); const alerts = [...(scenario.alerts || [])].sort((a, b) => Number(a.logicalTime) - Number(b.logicalTime)); const routes = clone(scenario.routes || []); const stops = clone(scenario.stops || []); let state = { status: "PAUSED", playing: false, clock: Number(scenario.sharedClock?.start || events[0]?.logicalTime || 0), selectedVehicleId: "", selectedRouteId: "", selectedStopId: "", selectedEventId: "", selectedAlertId: "", followVehicle: false, mode: "ALL" };
    try { const saved = JSON.parse(storage.getItem(storageKey) || "null"); if (saved) state = { ...state, ...saved, status: "PAUSED", playing: false }; } catch { storage.removeItem(storageKey); }
    const persist = () => storage.setItem(storageKey, JSON.stringify({ ...state, status: "PAUSED", playing: false }));
    function select(selection = {}) { state.selectedVehicleId = text(selection.vehicleId); state.selectedRouteId = text(selection.routeId); state.selectedStopId = text(selection.stopId); state.selectedEventId = text(selection.eventId); state.selectedAlertId = text(selection.alertId); persist(); return snapshot(); }
    function clearSelection() { return select({}); }
    function follow(vehicleId) { state.selectedVehicleId = text(vehicleId); state.followVehicle = Boolean(vehicleId); persist(); return snapshot(); }
    function exitFollow() { state.followVehicle = false; persist(); return snapshot(); }
    function seek(logicalTime) { state.clock = Number(logicalTime); state.status = "PAUSED"; state.playing = false; persist(); return snapshot(); }
    function seekEvent(eventId) { const row = events.find((event) => event.eventId === eventId); if (row) { select({ vehicleId: row.vehicleId, routeId: row.routeId, eventId: row.eventId }); seek(row.logicalTime); } return snapshot(); }
    function seekAlert(alertId) { const row = alerts.find((alert) => alert.alertId === alertId); if (row) { select({ vehicleId: row.vehicleId, routeId: row.routeId, alertId: row.alertId }); seek(row.logicalTime); } return snapshot(); }
    function step(kind, direction = 1) { const collections = { vehicle: [...new Set(routes.map((route) => route.vehicleId))], route: routes.map((route) => route.routeId), stop: stops.map((stop) => stop.orderId), event: events.map((event) => event.eventId), alert: alerts.map((alert) => alert.alertId) }; const fields = { vehicle: "selectedVehicleId", route: "selectedRouteId", stop: "selectedStopId", event: "selectedEventId", alert: "selectedAlertId" }; const rows = collections[kind] || []; const field = fields[kind]; if (!field || !rows.length) return snapshot(); const current = rows.indexOf(state[field]); state[field] = rows[(current + direction + rows.length) % rows.length]; if (kind === "event") seekEvent(state[field]); else if (kind === "alert") seekAlert(state[field]); else persist(); return snapshot(); }
    function tick(delta = 1, reducedMotion = false) { state.clock += Number(delta); state.status = reducedMotion ? "PAUSED" : state.status; state.playing = reducedMotion ? false : state.playing; persist(); return snapshot(); }
    function setMode(mode) { state.mode = text(mode || "ALL"); persist(); return snapshot(); }
    function snapshot() { return { schemaVersion: "stct-fleet-replay-state-v1.7", ...clone(state), sharedClock: clone(scenario.sharedClock), tracks: clone(tracks), visibleEvents: events.filter((event) => Number(event.logicalTime) <= state.clock), selectedVehicleTrack: tracks.filter((track) => track.vehicleId === state.selectedVehicleId), boundary: scenario.boundary || "SYNTHETIC_REPLAY_NOT_REAL_FLEET", replayHash: IntegrityHash.hashValue({ state, scenarioHash: scenario.scenarioHash }) }; }
    function exportReplay() { return { schemaVersion: "stct-fleet-replay-export-v1.7", scenario: clone(scenario), replayState: snapshot(), exportHash: IntegrityHash.hashValue({ scenarioHash: scenario.scenarioHash, state }) }; }
    return { VERSION, tracks: () => clone(tracks), events: () => clone(events), alerts: () => clone(alerts), routes: () => clone(routes), stops: () => clone(stops), select, clearSelection, follow, exitFollow, seek, seekEvent, seekAlert, step, tick, setMode, snapshot, exportReplay };
  }
  return { VERSION, memoryStorage, syntheticScenario, createReplay };
});
