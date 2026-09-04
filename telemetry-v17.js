(function (root, factory) {
  "use strict";
  const integrity = root?.STCTV15?.integrityHash || (typeof require === "function" ? require("./integrity-hash-v151.js") : null);
  const reducer = root?.STCTV17?.executionReducer || (typeof require === "function" ? require("./execution-reducer-v17.js") : null);
  const api = factory(integrity, reducer);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) { root.STCTV17 = root.STCTV17 || { version: "1.7.0" }; root.STCTV17.telemetry = api; }
})(typeof globalThis !== "undefined" ? globalThis : this, function (IntegrityHash, Reducer) {
  "use strict";
  if (!IntegrityHash?.hashValue || !Reducer?.createEvent) throw new Error("Telemetry v1.7 dependencies are missing.");

  const VERSION = "stct-telemetry-v1.7";
  const COPY = Object.freeze({
    zh: { HIGH: "高置信", MEDIUM: "中置信", LOW: "低置信", FAILED: "匹配失败", UNMATCHED: "未匹配估算", privacy: "坐标默认不发送到外部服务", gps: "本地演示使用合成遥测，不包含真实 GPS 数据" },
    en: { HIGH: "High confidence", MEDIUM: "Medium confidence", LOW: "Low confidence", FAILED: "Match failed", UNMATCHED: "Unmatched estimate", privacy: "Coordinates are not sent to external services by default", gps: "The local demo uses synthetic telemetry and contains no live GPS data" },
    ja: { HIGH: "高信頼度", MEDIUM: "中信頼度", LOW: "低信頼度", FAILED: "マッチ失敗", UNMATCHED: "未マッチ推定", privacy: "座標は既定で外部サービスに送信されません", gps: "ローカルデモは合成テレメトリを使用し、実 GPS データを含みません" },
  });
  const clone = (value) => value === undefined ? undefined : typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const text = (value) => String(value ?? "").trim();
  const finite = (value) => Number.isFinite(Number(value));
  function fail(code, message, detail = {}) { const error = new Error(message); error.code = code; error.detail = clone(detail); throw error; }

  function observationIdentity(value) {
    return { schemaVersion: "stct-telemetry-observation-v1.7", observationId: value.observationId, executionRunHash: value.executionRunHash, vehicleId: value.vehicleId, logicalTime: value.logicalTime, coordinate: value.coordinate, source: value.source, accuracyMeters: value.accuracyMeters };
  }
  function rawClaimIdentity(value) { return { reportedRoadEdgeId: value.reportedRoadEdgeId, reportedDistance: value.reportedDistance, reportedSpeed: value.reportedSpeed }; }
  function rawRecordIdentity(value) { return { ...observationIdentity(value), ...rawClaimIdentity(value) }; }
  function providerIdentity(value = {}) { return { schemaVersion: text(value.schemaVersion), providerId: text(value.providerId), providerVersion: text(value.providerVersion), availability: text(value.availability), mode: text(value.mode), profile: text(value.profile), requestHash: text(value.requestHash), graphHash: text(value.graphHash), trafficMode: text(value.trafficMode), departureTimeApplied: value.departureTimeApplied === true, privacyMode: text(value.privacyMode), endpointCategory: text(value.endpointCategory), dataClassification: text(value.dataClassification), boundary: text(value.boundary), fallbackReason: text(value.fallbackReason) }; }

  function createObservation(input = {}) {
    const value = {
      schemaVersion: "stct-telemetry-observation-v1.7",
      observationId: text(input.observationId),
      executionRunHash: text(input.executionRunHash),
      vehicleId: text(input.vehicleId),
      logicalTime: Number(input.logicalTime),
      coordinate: Array.isArray(input.coordinate) ? input.coordinate.map(Number) : null,
      reportedRoadEdgeId: text(input.reportedRoadEdgeId),
      reportedDistance: input.reportedDistance == null ? null : Number(input.reportedDistance),
      reportedSpeed: input.reportedSpeed == null ? null : Number(input.reportedSpeed),
      source: text(input.source || "SYNTHETIC_TELEMETRY"),
      accuracyMeters: Number(input.accuracyMeters ?? 10),
    };
    if (!value.observationId || !value.executionRunHash || !value.vehicleId || !finite(value.logicalTime) || !Array.isArray(value.coordinate) || value.coordinate.length !== 2 || !value.coordinate.every(finite) || !finite(value.accuracyMeters) || value.accuracyMeters < 0) fail("TELEMETRY_OBSERVATION_INVALID", "Telemetry observation identity is incomplete.", value);
    value.observationHash = IntegrityHash.hashValue(observationIdentity(value));
    value.rawClaimHash = IntegrityHash.hashValue(rawClaimIdentity(value));
    value.rawRecordHash = IntegrityHash.hashValue(rawRecordIdentity(value));
    return value;
  }

  function derivedIdentity(value) {
    return {
      schemaVersion: "stct-derived-telemetry-v1.7",
      observationHash: value.observationHash,
      previousObservationHash: value.previousObservationHash,
      executionRunHash: value.executionRunHash,
      vehicleId: value.vehicleId,
      logicalTime: value.logicalTime,
      matchedCoordinate: value.matchedCoordinate,
      matchedEdgeId: value.matchedEdgeId,
      snapDistanceMeters: value.snapDistanceMeters,
      matchConfidence: value.matchConfidence,
      matchStatus: value.matchStatus,
      derivedSegmentDistanceMeters: value.derivedSegmentDistanceMeters,
      derivedDurationSeconds: value.derivedDurationSeconds,
      derivedSpeedKph: value.derivedSpeedKph,
      routeCorridorDistanceMeters: value.routeCorridorDistanceMeters,
      offRoute: value.offRoute,
      plausibility: value.plausibility,
      providerProvenance: providerIdentity(value.providerProvenance),
    };
  }

  function createDerived(input = {}) {
    const value = {
      schemaVersion: "stct-derived-telemetry-v1.7",
      observationHash: text(input.observationHash),
      previousObservationHash: text(input.previousObservationHash),
      executionRunHash: text(input.executionRunHash),
      vehicleId: text(input.vehicleId),
      logicalTime: Number(input.logicalTime),
      matchedCoordinate: Array.isArray(input.matchedCoordinate) ? input.matchedCoordinate.map(Number) : null,
      matchedEdgeId: text(input.matchedEdgeId),
      snapDistanceMeters: Number(input.snapDistanceMeters ?? 0),
      matchConfidence: text(input.matchConfidence),
      matchStatus: text(input.matchStatus),
      derivedSegmentDistanceMeters: Number(input.derivedSegmentDistanceMeters ?? 0),
      derivedDurationSeconds: Number(input.derivedDurationSeconds ?? 0),
      derivedSpeedKph: Number(input.derivedSpeedKph ?? 0),
      routeCorridorDistanceMeters: Number(input.routeCorridorDistanceMeters ?? 0),
      offRoute: input.offRoute === true,
      plausibility: clone(input.plausibility || { status: "PASS", reasons: [] }),
      providerProvenance: clone(input.providerProvenance || {}),
    };
    if (!value.observationHash || !value.executionRunHash || !value.vehicleId || !finite(value.logicalTime) || !Array.isArray(value.matchedCoordinate) || value.matchedCoordinate.length !== 2 || !value.matchConfidence || !value.matchStatus || !["PASS", "WARN", "REJECT"].includes(value.plausibility.status)) fail("DERIVED_TELEMETRY_INVALID", "Derived telemetry identity is incomplete.", value);
    value.derivedTelemetryHash = IntegrityHash.hashValue(derivedIdentity(value));
    return value;
  }

  function eventsFromDerived(run, observation, derived, options = {}) {
    if (derived.plausibility.status === "REJECT") return [];
    const base = { executionRunHash: run.executionRunHash, executionRevision: run.revision, logicalTime: derived.logicalTime, routeId: text(options.routeId), vehicleId: derived.vehicleId, source: "VERIFIED_TELEMETRY_PIPELINE", payload: { planRevision: Number(options.planRevision ?? run.revision), routeRevision: Number(options.routeRevision ?? run.revision), observationHash: derived.observationHash, derivedTelemetryHash: derived.derivedTelemetryHash, telemetryStatus: derived.plausibility.status, reported: rawClaimIdentity(observation), derived: { matchedEdgeId: derived.matchedEdgeId, segmentDistanceMeters: derived.derivedSegmentDistanceMeters, speedKph: derived.derivedSpeedKph, offRoute: derived.offRoute, matchStatus: derived.matchStatus } } };
    let sequence = Number(options.sequenceStart || 1); const values = [];
    values.push(Reducer.createEvent(run, { ...base, eventId: `${text(options.eventPrefix || "TEL")}-${sequence}-POSITION`, sequence: sequence++, eventType: "POSITION_RECORDED", coordinate: derived.matchedCoordinate, roadEdgeId: derived.matchedEdgeId }));
    if (derived.offRoute && options.previousOffRoute !== true) values.push(Reducer.createEvent(run, { ...base, eventId: `${text(options.eventPrefix || "TEL")}-${sequence}-OFF_ROUTE`, sequence: sequence++, eventType: "OFF_ROUTE_DETECTED", coordinate: derived.matchedCoordinate, roadEdgeId: derived.matchedEdgeId }));
    if (!derived.offRoute && options.previousOffRoute === true) values.push(Reducer.createEvent(run, { ...base, eventId: `${text(options.eventPrefix || "TEL")}-${sequence}-REJOIN`, sequence: sequence++, eventType: "ROUTE_REJOINED", coordinate: derived.matchedCoordinate, roadEdgeId: derived.matchedEdgeId }));
    return values;
  }

  function inspector(observation, derived) { return { schemaVersion: "stct-telemetry-inspector-v1.7", reported: rawClaimIdentity(observation), derived: { matchedEdgeId: derived.matchedEdgeId, segmentDistanceMeters: derived.derivedSegmentDistanceMeters, speedKph: derived.derivedSpeedKph, offRoute: derived.offRoute, matchConfidence: derived.matchConfidence }, labels: { reported: "Reported", derived: "Derived" } }; }
  function trustLab(derived) { return { schemaVersion: "stct-telemetry-trust-lab-v1.7", formula: "speed_kph = derived_segment_distance_m / derived_duration_s * 3.6", providerId: text(derived.providerProvenance?.providerId), providerVersion: text(derived.providerProvenance?.providerVersion), graphHash: text(derived.providerProvenance?.graphHash), status: derived.plausibility.status }; }
  function csvRows(observation, derived) { return [{ raw_observation_id: observation.observationId, raw_reported_distance: observation.reportedDistance, raw_reported_speed: observation.reportedSpeed, raw_reported_edge: observation.reportedRoadEdgeId, derived_distance_m: derived.derivedSegmentDistanceMeters, derived_speed_kph: derived.derivedSpeedKph, derived_edge: derived.matchedEdgeId, derived_off_route: derived.offRoute, raw_hash: observation.rawRecordHash, derived_hash: derived.derivedTelemetryHash }]; }
  function noWebGLTable(rows = []) { return { mode: "NO_WEBGL_TELEMETRY_TABLE", columns: ["vehicleId", "logicalTime", "matchedEdgeId", "matchConfidence", "derivedSpeedKph", "offRoute"], rows: rows.map((row) => ({ vehicleId: row.vehicleId, logicalTime: row.logicalTime, matchedEdgeId: row.matchedEdgeId, matchConfidence: row.matchConfidence, derivedSpeedKph: row.derivedSpeedKph, offRoute: row.offRoute })) }; }
  function localeCopy(locale = "en") { return clone(COPY[locale] || COPY.en); }

  return { VERSION, COPY, observationIdentity, rawClaimIdentity, rawRecordIdentity, providerIdentity, createObservation, derivedIdentity, createDerived, eventsFromDerived, inspector, trustLab, csvRows, noWebGLTable, localeCopy };
});
