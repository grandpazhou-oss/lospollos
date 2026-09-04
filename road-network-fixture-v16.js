(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const api = factory(integrity);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) {
    root.STCTV16 = root.STCTV16 || { version: "1.6.0" };
    root.STCTV16.roadFixture = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash) {
  "use strict";

  if (!IntegrityHash?.hashValue) throw new Error("Road fixture v1.6 requires the v1.5.1 SHA-256 utility.");

  const VERSION = "stct-road-network-fixture-v1.6";
  const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));

  const nodes = [
    ["DEPOT", 121.4500, 31.2000, "DEPOT"],
    ["A", 121.4550, 31.2000, "JUNCTION"],
    ["B", 121.4600, 31.2000, "JUNCTION"],
    ["C", 121.4650, 31.2000, "JUNCTION"],
    ["N1", 121.4550, 31.2050, "JUNCTION"],
    ["N2", 121.4600, 31.2050, "JUNCTION"],
    ["N3", 121.4650, 31.2050, "JUNCTION"],
    ["S1", 121.4550, 31.1950, "JUNCTION"],
    ["S2", 121.4600, 31.1950, "JUNCTION"],
    ["S3", 121.4650, 31.1950, "JUNCTION"],
    ["H", 121.4700, 31.2000, "JUNCTION"],
    ["ZONE_B", 121.4750, 31.2000, "STOP"],
    ["LIGHT_ONLY", 121.4680, 31.1970, "STOP"],
    ["SNAP_A", 121.4520, 31.2020, "SNAP_CANDIDATE"],
    ["SNAP_B", 121.4522, 31.2020, "SNAP_CANDIDATE"],
    ["ISOLATED", 121.5000, 31.2200, "ISOLATED"],
  ].map(([nodeId, lon, lat, type]) => ({ nodeId, lon, lat, type }));

  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  function geometry(fromNodeId, toNodeId, bend) {
    const from = byId.get(fromNodeId); const to = byId.get(toNodeId);
    return bend ? [[from.lon, from.lat], bend, [to.lon, to.lat]] : [[from.lon, from.lat], [to.lon, to.lat]];
  }

  function edge(edgeId, fromNodeId, toNodeId, distanceMeters, options = {}) {
    return {
      edgeId,
      fromNodeId,
      toNodeId,
      distanceMeters,
      baseDurationSeconds: options.baseDurationSeconds || Math.ceil(distanceMeters / 8.33),
      geometry: geometry(fromNodeId, toNodeId, options.bend),
      roadClass: options.roadClass || "LOCAL",
      oneWay: options.oneWay === true,
      toll: options.toll === true,
      maxHeightM: options.maxHeightM ?? null,
      maxWidthM: options.maxWidthM ?? null,
      maxWeightKg: options.maxWeightKg ?? null,
      hazmatAllowed: options.hazmatAllowed !== false,
      vehicleTypes: options.vehicleTypes || ["LIGHT_TRUCK", "HEAVY_TRUCK", "VAN"],
      zoneIds: options.zoneIds || ["ZONE_A"],
    };
  }

  const edges = [
    edge("E_DEPOT_A", "DEPOT", "A", 520),
    edge("E_A_DEPOT", "A", "DEPOT", 540),
    edge("E_A_B_ONEWAY", "A", "B", 500, { oneWay: true, roadClass: "ARTERIAL" }),
    edge("E_B_C", "B", "C", 500, { roadClass: "ARTERIAL" }),
    edge("E_C_B", "C", "B", 540, { roadClass: "ARTERIAL" }),
    edge("E_A_N1", "A", "N1", 640),
    edge("E_N1_A", "N1", "A", 620),
    edge("E_N1_N2", "N1", "N2", 520),
    edge("E_N2_N1", "N2", "N1", 560),
    edge("E_N2_B", "N2", "B", 620),
    edge("E_B_N2", "B", "N2", 660),
    edge("E_N2_N3", "N2", "N3", 520),
    edge("E_N3_N2", "N3", "N2", 540),
    edge("E_N3_C", "N3", "C", 620),
    edge("E_C_N3", "C", "N3", 600),
    edge("E_C_H_LOW", "C", "H", 430, { roadClass: "UNDERPASS", maxHeightM: 3.0, maxWidthM: 2.6 }),
    edge("E_H_C_LOW", "H", "C", 450, { roadClass: "UNDERPASS", maxHeightM: 3.0, maxWidthM: 2.6 }),
    edge("E_N3_H_FREE", "N3", "H", 980, { roadClass: "COLLECTOR", zoneIds: ["ZONE_A", "ZONE_B"] }),
    edge("E_H_N3_FREE", "H", "N3", 1030, { roadClass: "COLLECTOR", zoneIds: ["ZONE_A", "ZONE_B"] }),
    edge("E_H_ZONE_B_FREE", "H", "ZONE_B", 950, { roadClass: "LOCAL", zoneIds: ["ZONE_B"] }),
    edge("E_ZONE_B_H_FREE", "ZONE_B", "H", 1020, { roadClass: "LOCAL", zoneIds: ["ZONE_B"] }),
    edge("E_C_ZONE_B_TOLL", "C", "ZONE_B", 780, { toll: true, roadClass: "EXPRESSWAY", zoneIds: ["ZONE_A", "ZONE_B"] }),
    edge("E_ZONE_B_C_TOLL", "ZONE_B", "C", 820, { toll: true, roadClass: "EXPRESSWAY", zoneIds: ["ZONE_A", "ZONE_B"] }),
    edge("E_A_S1_NARROW", "A", "S1", 620, { maxWidthM: 2.2, roadClass: "NARROW" }),
    edge("E_S1_A_NARROW", "S1", "A", 620, { maxWidthM: 2.2, roadClass: "NARROW" }),
    edge("E_S1_S2_HAZMAT", "S1", "S2", 520, { hazmatAllowed: false }),
    edge("E_S2_S1_HAZMAT", "S2", "S1", 540, { hazmatAllowed: false }),
    edge("E_S2_S3_WEIGHT", "S2", "S3", 520, { maxWeightKg: 7000, roadClass: "BRIDGE" }),
    edge("E_S3_S2_WEIGHT", "S3", "S2", 540, { maxWeightKg: 7000, roadClass: "BRIDGE" }),
    edge("E_S3_C", "S3", "C", 620),
    edge("E_C_S3", "C", "S3", 640),
    edge("E_C_LIGHT_ONLY", "C", "LIGHT_ONLY", 610, { maxHeightM: 3.2, maxWeightKg: 8000, vehicleTypes: ["LIGHT_TRUCK", "VAN"] }),
    edge("E_LIGHT_ONLY_C", "LIGHT_ONLY", "C", 630, { maxHeightM: 3.2, maxWeightKg: 8000, vehicleTypes: ["LIGHT_TRUCK", "VAN"] }),
    edge("E_DEPOT_SNAP_A", "DEPOT", "SNAP_A", 360),
    edge("E_SNAP_A_DEPOT", "SNAP_A", "DEPOT", 370),
    edge("E_SNAP_A_SNAP_B", "SNAP_A", "SNAP_B", 30),
    edge("E_SNAP_B_SNAP_A", "SNAP_B", "SNAP_A", 30),
    edge("E_SNAP_B_N1", "SNAP_B", "N1", 420),
    edge("E_N1_SNAP_B", "N1", "SNAP_B", 430),
  ];

  const restrictions = [
    { restrictionId: "R_NO_A_B_TO_B_C", type: "NO_TURN", fromEdgeId: "E_A_B_ONEWAY", toEdgeId: "E_B_C", note: "Fixture no-turn at B" },
    { restrictionId: "R_LOW_UNDERPASS", type: "MAX_HEIGHT", edgeId: "E_C_H_LOW", limit: 3.0 },
    { restrictionId: "R_NARROW_SOUTH", type: "MAX_WIDTH", edgeId: "E_A_S1_NARROW", limit: 2.2 },
    { restrictionId: "R_WEIGHT_BRIDGE", type: "MAX_WEIGHT", edgeId: "E_S2_S3_WEIGHT", limit: 7000 },
    { restrictionId: "R_HAZMAT_SOUTH", type: "HAZMAT_FORBIDDEN", edgeId: "E_S1_S2_HAZMAT" },
    { restrictionId: "R_LIGHT_TERMINAL", type: "VEHICLE_TYPE", edgeId: "E_C_LIGHT_ONLY", allowed: ["LIGHT_TRUCK", "VAN"] },
    { restrictionId: "R_TOLL_SHORTCUT", type: "TOLL", edgeId: "E_C_ZONE_B_TOLL" },
  ];

  const zones = [
    { zoneId: "ZONE_A", label: "Synthetic West Service Zone", classification: "SYNTHETIC" },
    { zoneId: "ZONE_B", label: "Synthetic East Service Zone", classification: "SYNTHETIC" },
  ];

  function semanticGraph() {
    return {
      schemaVersion: "stct-road-graph-v1.6",
      graphId: "SYNTHETIC-ROAD-FIXTURE-V16",
      coordinateReference: "EPSG:4326",
      dataClassification: "SYNTHETIC",
      customerRoadClaim: false,
      nodes,
      edges,
      restrictions,
      zones,
    };
  }

  const graphHash = IntegrityHash.hashValue(semanticGraph());
  const graph = Object.freeze({ ...semanticGraph(), graphHash });
  const snapPoints = Object.freeze({
    HIGH: { pointId: "SNAP-HIGH", lon: 121.45003, lat: 31.20001 },
    MEDIUM: { pointId: "SNAP-MEDIUM", lon: 121.45022, lat: 31.20012 },
    LOW: { pointId: "SNAP-LOW", lon: 121.45070, lat: 31.20045 },
    FAILED: { pointId: "SNAP-FAILED", lon: 121.4900, lat: 31.2400 },
    MULTI: { pointId: "SNAP-MULTI", lon: 121.45210, lat: 31.20200 },
  });
  const scenarios = Object.freeze({
    detour: { from: "DEPOT", to: "C" },
    oneWay: { from: "B", to: "A" },
    lowUnderpass: { from: "C", to: "H" },
    tollChoice: { from: "C", to: "ZONE_B" },
    closure: { from: "H", to: "ZONE_B", edgeId: "E_H_ZONE_B_FREE" },
    lightOnly: { from: "C", to: "LIGHT_ONLY" },
    isolated: { from: "DEPOT", to: "ISOLATED" },
    crossZone: { from: "DEPOT", to: "ZONE_B" },
  });

  function createFixture() {
    return { ...clone(graph), nodes: clone(nodes), edges: clone(edges), restrictions: clone(restrictions), zones: clone(zones), snapPoints: clone(snapPoints), scenarios: clone(scenarios) };
  }

  return { VERSION, graphHash, createFixture, snapPoints: clone(snapPoints), scenarios: clone(scenarios) };
});
