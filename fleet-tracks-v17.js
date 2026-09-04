(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const api = factory(integrity);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV17 = root.STCTV17 || { version: "1.7.0" }; root.STCTV17.fleetTracks = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash) {
  "use strict";
  if (!IntegrityHash?.hashValue) throw new Error("Fleet Tracks v1.7 dependencies are missing.");
  const VERSION = "stct-fleet-tracks-v1.7";
  const COPY = Object.freeze({
    zh: { all: "全部车辆", selected: "所选车辆", atRisk: "风险车辆", offRoute: "偏航车辆", stale: "数据陈旧", synthetic: "合成车队回放，不代表真实车队" },
    en: { all: "All vehicles", selected: "Selected vehicle", atRisk: "At risk", offRoute: "Off route", stale: "Stale", synthetic: "Synthetic fleet replay, not a live fleet" },
    ja: { all: "全車両", selected: "選択車両", atRisk: "リスク車両", offRoute: "ルート逸脱", stale: "データ遅延", synthetic: "合成車両リプレイであり、実車両ではありません" },
  });
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  const trackKey = (row) => `${text(row.vehicleId)}|${text(row.routeId)}|${Number(row.routeRevision || 1)}|${text(row.handoverId || "BASE")}`;

  function build(rows = [], options = {}) {
    const grouped = new Map();
    for (const row of rows) {
      const key = trackKey(row); if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(clone(row));
    }
    return [...grouped.entries()].map(([key, values]) => {
      values.sort((a, b) => Number(a.logicalTime) - Number(b.logicalTime) || text(a.derivedTelemetryHash).localeCompare(text(b.derivedTelemetryHash), "en")); const first = values[0];
      const positions = values.map((row) => ({ logicalTime: Number(row.logicalTime), coordinate: clone(row.matchedCoordinate), matchedEdgeId: text(row.matchedEdgeId), offRoute: row.offRoute === true, derivedTelemetryHash: text(row.derivedTelemetryHash), matchConfidence: text(row.matchConfidence), alertCount: Number(row.alertCount || 0) }));
      const matchedSegments = positions.slice(1).map((position, index) => ({ from: clone(positions[index].coordinate), to: clone(position.coordinate), fromTime: positions[index].logicalTime, toTime: position.logicalTime, offRoute: positions[index].offRoute || position.offRoute, sourceHashes: [positions[index].derivedTelemetryHash, position.derivedTelemetryHash] }));
      const track = { schemaVersion: "stct-vehicle-track-v1.7", trackKey: key, vehicleId: text(first.vehicleId), routeId: text(first.routeId), routeRevision: Number(first.routeRevision || 1), handoverId: text(first.handoverId || "BASE"), positions, matchedSegments, currentPosition: clone(positions.at(-1) || null), progress: Number(first.progress || 0), source: "DERIVED_TELEMETRY_ONLY", trackHash: "" };
      track.trackHash = IntegrityHash.hashValue({ ...track, trackHash: "" }); return track;
    }).sort((a, b) => a.vehicleId.localeCompare(b.vehicleId, "en") || a.routeId.localeCompare(b.routeId, "en") || a.routeRevision - b.routeRevision);
  }

  function currentMarkers(tracks = [], options = {}) {
    const completed = new Set(options.completedVehicleIds || []); const latest = new Map();
    for (const track of tracks) { const prior = latest.get(track.vehicleId); if (!prior || Number(track.currentPosition?.logicalTime || -Infinity) > Number(prior.currentPosition?.logicalTime || -Infinity)) latest.set(track.vehicleId, track); }
    return [...latest.values()].filter((track) => options.includeCompletedHistory === true || !completed.has(track.vehicleId)).map((track) => ({ schemaVersion: "stct-fleet-marker-v1.7", vehicleId: track.vehicleId, routeId: track.routeId, routeRevision: track.routeRevision, coordinate: clone(track.currentPosition?.coordinate), logicalTime: track.currentPosition?.logicalTime, offRoute: track.currentPosition?.offRoute === true, selected: track.vehicleId === options.selectedVehicleId, risk: track.currentPosition?.offRoute === true || Number(track.currentPosition?.alertCount || 0) > 0, glyph: track.vehicleId === options.selectedVehicleId ? "SELECTED_RING" : track.currentPosition?.offRoute ? "OFF_ROUTE_TRIANGLE" : "VEHICLE_SQUARE", semanticLabel: `${track.vehicleId} ${track.currentPosition?.offRoute ? "OFF_ROUTE" : "ON_ROUTE"}` }));
  }

  function filterMarkers(markers = [], mode = "ALL", options = {}) {
    const now = Number(options.now || 0); const staleThreshold = Number(options.staleThreshold || 300);
    return markers.filter((marker) => mode === "ALL" || (mode === "SELECTED" && marker.vehicleId === options.selectedVehicleId) || (mode === "AT_RISK" && marker.risk) || (mode === "OFF_ROUTE" && marker.offRoute) || (mode === "STALE" && now - Number(marker.logicalTime || 0) > staleThreshold));
  }

  function lod(tracks = [], options = {}) {
    const zoom = Number(options.zoom || 10); const selected = text(options.selectedVehicleId); const risk = new Set(options.riskVehicleIds || []); const markerRows = currentMarkers(tracks, options);
    return { schemaVersion: "stct-fleet-lod-v1.7", zoom, clustering: zoom < 8, showStops: zoom >= 13, markers: zoom < 8 ? [{ cluster: true, count: markerRows.length, glyph: "CLUSTER_COUNT" }] : markerRows, trails: tracks.map((track) => { const full = track.vehicleId === selected; const atRisk = risk.has(track.vehicleId) || track.currentPosition?.offRoute; const limit = full ? track.positions.length : atRisk ? Math.min(12, track.positions.length) : Math.min(3, track.positions.length); return { vehicleId: track.vehicleId, routeId: track.routeId, full, risk: atRisk, positions: clone(track.positions.slice(-limit)), linePattern: full ? "SOLID_SELECTED" : atRisk ? "DASHED_RISK" : "SHORT_DOTTED", icon: full ? "SELECTED_RING" : atRisk ? "RISK_TRIANGLE" : "VEHICLE_SQUARE" }; }), lodEvidence: { selectedTrail: "FULL", riskTrail: "UP_TO_12", otherTrail: "LAST_3", lowZoom: "CLUSTER", highZoom: "STOPS_AND_LABELS" } };
  }

  function fleetTable(tracks = [], options = {}) { const markers = currentMarkers(tracks, { ...options, includeCompletedHistory: true }); return { schemaVersion: "stct-fleet-table-v1.7", mode: options.noWebGL ? "NO_WEBGL_FLEET_TABLE" : "FLEET_TABLE", columns: ["vehicleId", "routeId", "logicalTime", "offRoute", "risk", "selected"], rows: markers.map(({ coordinate, glyph, semanticLabel, ...row }) => ({ ...row, statusText: semanticLabel })) }; }
  function timelineLanes(tracks = [], vehicleId = "") { return tracks.filter((track) => !vehicleId || track.vehicleId === vehicleId).map((track) => ({ laneId: `${track.routeId}|${track.vehicleId}|${track.routeRevision}`, routeId: track.routeId, vehicleId: track.vehicleId, routeRevision: track.routeRevision, start: track.positions[0]?.logicalTime ?? null, end: track.positions.at(-1)?.logicalTime ?? null, eventCount: track.positions.length })); }
  function mobileView(mode, tracks = [], options = {}) { const rows = fleetTable(tracks, options).rows; const riskFirst = [...rows].sort((a, b) => Number(b.risk) - Number(a.risk) || a.vehicleId.localeCompare(b.vehicleId, "en")); return { mode: text(mode || "ALL"), segmentedControl: ["ALL", "SELECTED"], portraitRows: riskFirst, landscape: { timelineVisible: true, lanes: timelineLanes(tracks, options.selectedVehicleId || "") } }; }
  function localeCopy(locale = "en") { return clone(COPY[locale] || COPY.en); }

  function createSourceManager() {
    const sources = new Map(); const layers = new Map();
    function open(key, payload) { const id = text(key); sources.set(id, clone(payload)); layers.set(`${id}-trail`, { sourceId: id, type: "line" }); layers.set(`${id}-marker`, { sourceId: id, type: "symbol" }); return snapshot(); }
    function close(key) { const id = text(key); sources.delete(id); [...layers.keys()].filter((layerId) => layerId.startsWith(`${id}-`)).forEach((layerId) => layers.delete(layerId)); return snapshot(); }
    function clear() { sources.clear(); layers.clear(); return snapshot(); }
    function snapshot() { return { sourceCount: sources.size, layerCount: layers.size, sourceIds: [...sources.keys()].sort(), layerIds: [...layers.keys()].sort() }; }
    return { open, close, clear, snapshot };
  }

  return { VERSION, COPY, trackKey, build, currentMarkers, filterMarkers, lod, fleetTable, timelineLanes, mobileView, localeCopy, createSourceManager };
});
