#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Integrity = require("../integrity-hash-v151.js");
const Twin = require("../execution-twin-v16.js");
const RoadFixture = require("../road-network-fixture-v16.js");
const RoadRouting = require("../road-routing-v16.js");
const Providers = require("../routing-provider-registry-v16.js");
const Telemetry = require("../telemetry-v17.js");
const Matcher = require("../telemetry-matcher-v17.js");
const Validator = require("../telemetry-validator-v17.js");
const Pipeline = require("../telemetry-pipeline-v17.js");

const assertions = [];
const isSha256 = (value) => /^sha256:[a-f0-9]{64}$/.test(String(value));
function check(requirementId, condition, observed, expected) {
  assert(condition, `${requirementId}: observed=${JSON.stringify(observed)} expected=${JSON.stringify(expected)}`);
  assertions.push({ assertionId: `${requirementId}-A1`, requirementId, status: "PASS", observed, expected, evidence: "tests/test_verified_telemetry_v17.js" });
}

const graph = RoadFixture.createFixture();
const corridor = [[121.45, 31.2], [121.455, 31.2], [121.46, 31.2], [121.465, 31.2]];
const run = Twin.createRun({ scenarioId: "TELEMETRY-V17", inputHash: Integrity.hashValue({ input: 17 }), planHash: Integrity.hashValue({ plan: 17 }), routeGeometryHash: Integrity.hashValue(corridor), matrixHash: Integrity.hashValue({ matrix: 17 }), providerProvenance: { providerId: "SYNTHETIC_ROAD_FIXTURE" }, simulationSeed: "17", executionProfile: "ON_TIME", logicalStartMinute: 0, revision: 1 });

function observation(id, logicalTime, coordinate = [121.45003, 31.20001], overrides = {}) {
  return Telemetry.createObservation({ observationId: id, executionRunHash: run.executionRunHash, vehicleId: overrides.vehicleId || "V1", logicalTime, coordinate, reportedRoadEdgeId: overrides.reportedRoadEdgeId || "", reportedDistance: overrides.reportedDistance ?? 999999, reportedSpeed: overrides.reportedSpeed ?? 999, source: overrides.source || "SYNTHETIC_TELEMETRY", accuracyMeters: overrides.accuracyMeters ?? 5 });
}
function options(overrides = {}) { return { provider: Providers.fixtureProvider(), graph, routeGeometry: corridor, routeId: "R1", run, planRevision: 1, routeRevision: 1, reorderWindowSeconds: 5, ...overrides }; }

async function main() {
  const first = observation("OBS-1", 100); const firstDerived = await Matcher.derive(first, null, options());
  check("T144", first.schemaVersion === "stct-telemetry-observation-v1.7" && ["observationId", "executionRunHash", "vehicleId", "logicalTime", "coordinate", "reportedRoadEdgeId", "reportedDistance", "reportedSpeed", "source", "accuracyMeters"].every((key) => Object.hasOwn(first, key)), Object.keys(first), "TelemetryObservation schema");
  check("T145", isSha256(first.observationHash) && Validator.validateObservation(first).status === "PASS", first.observationHash, "valid SHA-256 observation hash");
  check("T146", firstDerived.schemaVersion === "stct-derived-telemetry-v1.7" && ["observationHash", "previousObservationHash", "matchedCoordinate", "matchedEdgeId", "snapDistanceMeters", "matchConfidence", "derivedSegmentDistanceMeters", "derivedDurationSeconds", "derivedSpeedKph", "routeCorridorDistanceMeters", "offRoute", "plausibility", "providerProvenance", "derivedTelemetryHash"].every((key) => Object.hasOwn(firstDerived, key)), Object.keys(firstDerived), "DerivedTelemetry schema");
  check("T147", isSha256(firstDerived.derivedTelemetryHash) && Validator.validateDerived(firstDerived).status === "PASS", firstDerived.derivedTelemetryHash, "valid SHA-256 derived hash");
  check("T148", first.reportedDistance !== firstDerived.derivedSegmentDistanceMeters && first.rawRecordHash !== firstDerived.derivedTelemetryHash, { raw: first.reportedDistance, derived: firstDerived.derivedSegmentDistanceMeters }, "separate raw and derived values/hashes");
  check("T149", first.reportedDistance === 999999 && firstDerived.derivedSegmentDistanceMeters === 0 && Validator.metrics([firstDerived]).distanceMeters === 0, { reported: first.reportedDistance, derived: firstDerived.derivedSegmentDistanceMeters, metric: Validator.metrics([firstDerived]).distanceMeters }, { reported: 999999, derived: 0, metric: 0 });
  const falseRoadClaim = observation("OBS-ROAD-CLAIM", 100, [121.45003, 31.20001], { reportedRoadEdgeId: "NOT_A_REAL_EDGE" }); const falseRoadDerived = await Matcher.derive(falseRoadClaim, null, options());
  check("T150", falseRoadDerived.matchedEdgeId === "E_DEPOT_A" && falseRoadDerived.matchedEdgeId !== falseRoadClaim.reportedRoadEdgeId, { reported: falseRoadClaim.reportedRoadEdgeId, derived: falseRoadDerived.matchedEdgeId }, "provider-owned matched edge");
  const offClaim = observation("OBS-OFF-CLAIM", 100, [121.45003, 31.20001]); offClaim.reportedOffRoute = true; const offClaimDerived = await Matcher.derive(offClaim, null, options());
  check("T151", offClaimDerived.offRoute === false, { reportedOffRoute: offClaim.reportedOffRoute, derivedOffRoute: offClaimDerived.offRoute }, { derivedOffRoute: false });
  {
    const base = Providers.fixtureProvider(); let calls = 0; const provider = { id: base.id, version: base.version, match: async (request) => { calls += 1; return base.match(request); } }; const derived = await Matcher.derive(first, null, options({ provider }));
    check("T152", calls === 1 && derived.providerProvenance.providerId === "SYNTHETIC_ROAD_FIXTURE", { calls, provider: derived.providerProvenance.providerId }, { calls: 1, provider: "SYNTHETIC_ROAD_FIXTURE" });
  }
  check("T153", firstDerived.matchedEdgeId === "E_DEPOT_A" && firstDerived.matchStatus === "ROAD_MATCHED", { edge: firstDerived.matchedEdgeId, status: firstDerived.matchStatus }, { edge: "E_DEPOT_A", status: "ROAD_MATCHED" });
  check("T154", firstDerived.snapDistanceMeters > 0 && firstDerived.snapDistanceMeters < 5, firstDerived.snapDistanceMeters, "provider snap distance between 0 and 5m");
  check("T155", firstDerived.matchConfidence === "HIGH", firstDerived.matchConfidence, "HIGH");
  const second = observation("OBS-2", 160, [121.45502, 31.20001]); const secondDerived = await Matcher.derive(second, firstDerived, options()); const expectedDistance = RoadRouting.haversineMeters(firstDerived.matchedCoordinate, secondDerived.matchedCoordinate);
  check("T156", Math.abs(secondDerived.derivedSegmentDistanceMeters - expectedDistance) < 0.01, secondDerived.derivedSegmentDistanceMeters, Number(expectedDistance.toFixed(3)));
  check("T157", secondDerived.derivedDurationSeconds === 60, secondDerived.derivedDurationSeconds, 60);
  check("T158", Math.abs(secondDerived.derivedSpeedKph - secondDerived.derivedSegmentDistanceMeters / 60 * 3.6) < 0.001, secondDerived.derivedSpeedKph, "distance / duration * 3.6");
  check("T159", secondDerived.routeCorridorDistanceMeters < 5, secondDerived.routeCorridorDistanceMeters, "<5m from corridor");
  const far = observation("OBS-FAR", 220, [121.475, 31.2]); const farDerived = await Matcher.derive(far, secondDerived, options({ offRouteThresholdMeters: 100 }));
  check("T160", farDerived.offRoute === true && farDerived.routeCorridorDistanceMeters > 100, { offRoute: farDerived.offRoute, corridorDistance: farDerived.routeCorridorDistanceMeters }, { offRoute: true, corridorDistance: ">100" });
  const rejoin = observation("OBS-REJOIN", 280, [121.46001, 31.2]); const rejoinDerived = await Matcher.derive(rejoin, farDerived, options({ offRouteThresholdMeters: 100 }));
  check("T161", farDerived.offRoute === true && rejoinDerived.offRoute === false, { before: farDerived.offRoute, after: rejoinDerived.offRoute }, { before: true, after: false });
  const fallback = await Matcher.derive(first, null, options({ provider: null }));
  check("T162", fallback.matchStatus === "UNMATCHED_ESTIMATE" && fallback.matchConfidence === "UNMATCHED", { status: fallback.matchStatus, confidence: fallback.matchConfidence }, { status: "UNMATCHED_ESTIMATE", confidence: "UNMATCHED" });
  check("T163", fallback.matchStatus !== "ROAD_MATCHED" && fallback.matchedEdgeId === "", { status: fallback.matchStatus, edge: fallback.matchedEdgeId }, { notRoadMatched: true, edge: "" });
  check("T164", falseRoadDerived.plausibility.reasons.includes("ROAD_EDGE_NOT_IN_GRAPH"), falseRoadDerived.plausibility, "ROAD_EDGE_NOT_IN_GRAPH");
  const farClaim = observation("OBS-FAR-CLAIM", 100, [121.475, 31.2], { reportedRoadEdgeId: "E_DEPOT_A" }); const farClaimDerived = await Matcher.derive(farClaim, null, options());
  check("T165", farClaimDerived.plausibility.reasons.includes("COORDINATE_TOO_FAR_FROM_CLAIMED_EDGE"), farClaimDerived.plausibility, "COORDINATE_TOO_FAR_FROM_CLAIMED_EDGE");
  const backwards = observation("OBS-BACK", 90, [121.455, 31.2]); const backwardsDerived = await Matcher.derive(backwards, firstDerived, options());
  check("T166", backwardsDerived.plausibility.status === "REJECT" && backwardsDerived.plausibility.reasons.includes("TIME_MOVED_BACKWARDS"), backwardsDerived.plausibility, { status: "REJECT", reason: "TIME_MOVED_BACKWARDS" });
  const zero = observation("OBS-ZERO", 100, [121.45003, 31.20001]); const zeroDerived = await Matcher.derive(zero, firstDerived, options());
  check("T167", zeroDerived.derivedDurationSeconds === 0 && zeroDerived.derivedSegmentDistanceMeters === 0 && !zeroDerived.plausibility.reasons.includes("ZERO_DURATION_MOVEMENT"), { duration: zeroDerived.derivedDurationSeconds, distance: zeroDerived.derivedSegmentDistanceMeters, reasons: zeroDerived.plausibility.reasons }, { duration: 0, distance: 0 });
  check("T168", backwardsDerived.derivedDurationSeconds < 0 && backwardsDerived.plausibility.status === "REJECT", { duration: backwardsDerived.derivedDurationSeconds, status: backwardsDerived.plausibility.status }, { duration: "negative", status: "REJECT" });
  const fast = observation("OBS-FAST", 110, [121.455, 31.2]); const fastDerived = await Matcher.derive(fast, firstDerived, options());
  check("T169", fastDerived.derivedSpeedKph > 120 && fastDerived.plausibility.reasons.includes("IMPOSSIBLE_SPEED") && ["WARN", "REJECT"].includes(fastDerived.plausibility.status), { speed: fastDerived.derivedSpeedKph, plausibility: fastDerived.plausibility }, "WARN/REJECT impossible speed");
  const teleport = observation("OBS-TELEPORT", 105, [121.475, 31.2]); const teleportDerived = await Matcher.derive(teleport, firstDerived, options());
  check("T170", teleportDerived.plausibility.reasons.includes("TELEPORT") && ["WARN", "REJECT"].includes(teleportDerived.plausibility.status), teleportDerived.plausibility, "WARN/REJECT teleport");
  {
    const pipeline = Pipeline.createPipeline(options({ reorderWindowSeconds: 0 })); const once = await pipeline.ingest(first); const twice = await pipeline.ingest(first);
    check("T171", once.status === "CONFIRMED_AVAILABLE" && twice.status === "DUPLICATE_IDEMPOTENT" && pipeline.records().length === 1, { once: once.status, twice: twice.status, records: pipeline.records().length }, { once: "CONFIRMED_AVAILABLE", twice: "DUPLICATE_IDEMPOTENT", records: 1 });
    const changed = Telemetry.createObservation({ ...first, coordinate: [121.455, 31.2] }); const conflict = await pipeline.ingest(changed); check("T172", conflict.status === "CONFLICT" && conflict.code === "OBSERVATION_ID_PAYLOAD_CONFLICT", { status: conflict.status, code: conflict.code }, { status: "CONFLICT", code: "OBSERVATION_ID_PAYLOAD_CONFLICT" });
  }
  {
    const pipeline = Pipeline.createPipeline(options({ reorderWindowSeconds: 5 })); await pipeline.ingest(observation("REORDER-10", 10)); await pipeline.ingest(observation("REORDER-08", 8)); await pipeline.ingest(observation("REORDER-12", 12)); const flushed = await pipeline.flushAll("V1");
    check("T173", flushed.results.map((row) => row.observation.logicalTime).join(",") === "8,10,12", flushed.results.map((row) => row.observation.logicalTime), [8, 10, 12]);
  }
  {
    const pipeline = Pipeline.createPipeline(options({ reorderWindowSeconds: 5 })); await pipeline.ingest(observation("LATE-10", 10)); const late = await pipeline.ingest(observation("LATE-04", 4)); check("T174", late.status === "REJECTED" && late.code === "LATE_OBSERVATION_REJECTED", { status: late.status, code: late.code }, { status: "REJECTED", code: "LATE_OBSERVATION_REJECTED" });
  }
  {
    const pipeline = Pipeline.createPipeline(options({ reorderWindowSeconds: 0 })); await pipeline.ingest(observation("CONFIRMED-10", 10)); const before = pipeline.confirmed("V1").map((row) => row.observation.observationId); const late = await pipeline.ingest(observation("CONFIRMED-09", 9)); const after = pipeline.confirmed("V1").map((row) => row.observation.observationId); check("T175", late.status === "REJECTED" && JSON.stringify(before) === JSON.stringify(after), { late: late.status, before, after }, { late: "REJECTED", historyUnchanged: true });
  }
  const inaccurate = observation("OBS-INACCURATE", 100, [121.45003, 31.20001], { accuracyMeters: 150 }); const inaccurateDerived = await Matcher.derive(inaccurate, null, options());
  check("T176", inaccurateDerived.matchConfidence === "LOW", { providerSnap: "HIGH", accuracyMeters: inaccurate.accuracyMeters, derived: inaccurateDerived.matchConfidence }, "LOW after accuracy adjustment");
  check("T177", Validator.alertEvidence(inaccurateDerived).lowConfidence === true && Validator.alertEvidence(inaccurateDerived).derivedTelemetryHash === inaccurateDerived.derivedTelemetryHash, Validator.alertEvidence(inaccurateDerived), "low-confidence derived alert evidence");
  check("T178", firstDerived.providerProvenance.providerId === "SYNTHETIC_ROAD_FIXTURE" && firstDerived.providerProvenance.providerVersion && firstDerived.providerProvenance.graphHash === graph.graphHash, Telemetry.providerIdentity(firstDerived.providerProvenance), "fixture provider provenance");
  {
    const v1 = await Matcher.derive(first, null, options({ provider: Providers.fixtureProvider({ version: "fixture-1" }) })); const v2 = await Matcher.derive(first, null, options({ provider: Providers.fixtureProvider({ version: "fixture-2" }) })); check("T179", v1.providerProvenance.providerVersion !== v2.providerProvenance.providerVersion && v1.derivedTelemetryHash !== v2.derivedTelemetryHash, { versions: [v1.providerProvenance.providerVersion, v2.providerProvenance.providerVersion], hashes: [v1.derivedTelemetryHash, v2.derivedTelemetryHash] }, "version changes derived hash");
  }
  {
    const base = Providers.fixtureProvider(); const changedGraphProvider = { id: base.id, version: base.version, match: async (request) => { const result = await base.match(request); result.graphHash = Integrity.hashValue({ changedGraph: true }); result.providerProvenance.graphHash = result.graphHash; return result; } }; const changed = await Matcher.derive(first, null, options({ provider: changedGraphProvider })); check("T180", changed.providerProvenance.graphHash !== firstDerived.providerProvenance.graphHash && changed.derivedTelemetryHash !== firstDerived.derivedTelemetryHash, { graphHashes: [firstDerived.providerProvenance.graphHash, changed.providerProvenance.graphHash], derivedHashes: [firstDerived.derivedTelemetryHash, changed.derivedTelemetryHash] }, "graph hash changes derived hash");
  }
  const closed = await Matcher.derive(first, null, options({ closures: [{ edgeId: "E_DEPOT_A", reason: "TEST" }] }));
  check("T181", closed.matchStatus === "UNMATCHED_ESTIMATE" && closed.plausibility.reasons.includes("MATCHED_EDGE_CLOSED") && closed.derivedTelemetryHash !== firstDerived.derivedTelemetryHash, { status: closed.matchStatus, reasons: closed.plausibility.reasons }, "closure changes match result");
  const positionEvents = Telemetry.eventsFromDerived(run, first, firstDerived, { routeId: "R1", planRevision: 1, routeRevision: 1, sequenceStart: 1, eventPrefix: "EV" });
  check("T182", positionEvents[0].eventType === "POSITION_RECORDED" && positionEvents[0].payload.telemetryStatus === firstDerived.plausibility.status, positionEvents[0], "verified Position event");
  check("T183", positionEvents[0].payload.observationHash === first.observationHash, positionEvents[0].payload.observationHash, first.observationHash);
  check("T184", positionEvents[0].payload.derivedTelemetryHash === firstDerived.derivedTelemetryHash, positionEvents[0].payload.derivedTelemetryHash, firstDerived.derivedTelemetryHash);
  const offEvents = Telemetry.eventsFromDerived(run, far, farDerived, { routeId: "R1", planRevision: 1, routeRevision: 1, sequenceStart: 1, eventPrefix: "OFF", previousOffRoute: false });
  check("T185", offEvents.some((event) => event.eventType === "OFF_ROUTE_DETECTED" && event.payload.derivedTelemetryHash === farDerived.derivedTelemetryHash), offEvents.map((event) => event.eventType), ["POSITION_RECORDED", "OFF_ROUTE_DETECTED"]);
  const rejoinEvents = Telemetry.eventsFromDerived(run, rejoin, rejoinDerived, { routeId: "R1", planRevision: 1, routeRevision: 1, sequenceStart: 1, eventPrefix: "REJOIN", previousOffRoute: true });
  check("T186", rejoinEvents.some((event) => event.eventType === "ROUTE_REJOINED" && event.payload.derivedTelemetryHash === rejoinDerived.derivedTelemetryHash), rejoinEvents.map((event) => event.eventType), ["POSITION_RECORDED", "ROUTE_REJOINED"]);
  {
    const base = Providers.fixtureProvider(); let cancelled = false; const delayed = { id: base.id, version: base.version, match: async (request) => { await new Promise((resolve) => setTimeout(resolve, 20)); return base.match(request); }, cancel: () => { cancelled = true; } }; const pipeline = Pipeline.createPipeline(options({ provider: delayed, reorderWindowSeconds: 0 })); const pending = pipeline.ingest(observation("CANCEL-ME", 1)); setTimeout(() => pipeline.cancel(), 0); const result = await pending;
    check("T187", cancelled && result.flushed[0].status === "CANCELLED" && result.flushed[0].code === "TELEMETRY_PIPELINE_CANCELLED", { cancelled, result: result.flushed[0] }, { cancelled: true, status: "CANCELLED" });
  }
  {
    const base = Providers.fixtureProvider(); const delayed = { id: base.id, version: base.version, match: async (request) => { await new Promise((resolve) => setTimeout(resolve, 20)); return base.match(request); } }; const pipeline = Pipeline.createPipeline(options({ provider: delayed, reorderWindowSeconds: 0 })); const pending = pipeline.ingest(observation("STALE-ME", 1)); setTimeout(() => pipeline.reset(), 0); const result = await pending;
    check("T188", result.flushed[0].status === "STALE_REJECTED" && result.flushed[0].code === "TELEMETRY_PIPELINE_STALE_RESULT", result.flushed[0], { status: "STALE_REJECTED", code: "TELEMETRY_PIPELINE_STALE_RESULT" });
  }
  {
    const pipeline = Pipeline.createPipeline(options({ reorderWindowSeconds: 5 })); await pipeline.ingestBatch([observation("BATCH-3", 3), observation("BATCH-1", 1), observation("BATCH-2", 2)]); await pipeline.flushAll(); check("T189", pipeline.confirmed("V1").map((row) => row.observation.logicalTime).join(",") === "1,2,3", pipeline.confirmed("V1").map((row) => row.observation.logicalTime), [1, 2, 3]);
  }
  {
    const pipeline = Pipeline.createPipeline(options({ reorderWindowSeconds: 0 })); await pipeline.ingest(observation("V1-ONLY", 1, [121.45003, 31.20001], { vehicleId: "V1" })); await pipeline.ingest(observation("V2-ONLY", 1, [121.455, 31.2], { vehicleId: "V2" })); check("T190", pipeline.confirmed("V1").length === 1 && pipeline.confirmed("V2").length === 1 && pipeline.confirmed("V1")[0].derived.vehicleId === "V1" && pipeline.confirmed("V2")[0].derived.vehicleId === "V2", { V1: pipeline.confirmed("V1").length, V2: pipeline.confirmed("V2").length }, { V1: 1, V2: 1 });
  }
  check("T191", Validator.metrics([firstDerived, secondDerived]).source === "DERIVED_TELEMETRY_ONLY" && Validator.metrics([firstDerived, secondDerived]).distanceMeters === firstDerived.derivedSegmentDistanceMeters + secondDerived.derivedSegmentDistanceMeters, Validator.metrics([firstDerived, secondDerived]), "metrics read DerivedTelemetry only");
  check("T192", Validator.alertEvidence(farDerived).source === "DERIVED_TELEMETRY_ONLY" && Validator.alertEvidence(farDerived).offRoute === true, Validator.alertEvidence(farDerived), "alerts read DerivedTelemetry only");
  const inspector = Telemetry.inspector(second, secondDerived); check("T193", inspector.labels.reported === "Reported" && inspector.labels.derived === "Derived" && inspector.reported.reportedDistance !== inspector.derived.segmentDistanceMeters, inspector, "Reported versus Derived inspector");
  const trust = Telemetry.trustLab(secondDerived); check("T194", trust.formula.includes("derived_segment_distance_m") && trust.providerId === "SYNTHETIC_ROAD_FIXTURE" && trust.providerVersion, trust, "formula and provider provenance");
  const csv = Telemetry.csvRows(second, secondDerived)[0]; check("T195", Object.hasOwn(csv, "raw_reported_distance") && Object.hasOwn(csv, "derived_distance_m") && csv.raw_reported_distance !== csv.derived_distance_m, csv, "explicit raw and derived CSV columns");
  check("T196", Validator.validateBundle({ observation: second, derived: secondDerived, previousDerived: firstDerived }).status === "PASS", Validator.validateBundle({ observation: second, derived: secondDerived, previousDerived: firstDerived }), "deep telemetry bundle validation");
  {
    const tampered = structuredClone(secondDerived); tampered.derivedSegmentDistanceMeters += 1; const validation = Validator.validateDerived(tampered); check("T197", validation.status === "FAIL" && validation.errors.includes("DERIVED_HASH_STALE"), validation, { status: "FAIL", error: "DERIVED_HASH_STALE" });
  }
  {
    const rawA = observation("RAW-CLAIM-STABLE", 100, [121.45003, 31.20001], { reportedDistance: 1, reportedSpeed: 2, reportedRoadEdgeId: "E_DEPOT_A" }); const rawB = Telemetry.createObservation({ ...rawA, reportedDistance: 99999, reportedSpeed: 999 }); const derivedA = await Matcher.derive(rawA, null, options({ provider: Providers.fixtureProvider() })); const derivedB = await Matcher.derive(rawB, null, options({ provider: Providers.fixtureProvider() })); check("T198", rawA.observationHash === rawB.observationHash && rawA.rawClaimHash !== rawB.rawClaimHash && derivedA.derivedTelemetryHash === derivedB.derivedTelemetryHash, { observationHashes: [rawA.observationHash, rawB.observationHash], rawClaimHashes: [rawA.rawClaimHash, rawB.rawClaimHash], derivedHashes: [derivedA.derivedTelemetryHash, derivedB.derivedTelemetryHash] }, "reported distance and speed do not alter derived result; claimed-edge validation remains separate");
  }
  const table = Telemetry.noWebGLTable([firstDerived, secondDerived]); check("T199", table.mode === "NO_WEBGL_TELEMETRY_TABLE" && table.rows.length === 2 && table.columns.includes("matchConfidence"), table, "No-WebGL telemetry table");
  {
    const normal = await Matcher.derive(first, null, options({ provider: Providers.fixtureProvider() })); const reduced = await Matcher.derive(first, null, options({ provider: Providers.fixtureProvider(), reducedMotion: true })); check("T200", normal.derivedTelemetryHash === reduced.derivedTelemetryHash, { normal: normal.derivedTelemetryHash, reduced: reduced.derivedTelemetryHash }, "reduced motion has no telemetry effect");
  }
  check("T201", ["zh", "en", "ja"].every((locale) => ["HIGH", "MEDIUM", "LOW", "FAILED", "UNMATCHED"].every((key) => Telemetry.localeCopy(locale)[key])), Object.fromEntries(["zh", "en", "ja"].map((locale) => [locale, Telemetry.localeCopy(locale)])), "zh/en/ja confidence copy");
  check("T202", ["zh", "en", "ja"].every((locale) => Telemetry.localeCopy(locale).privacy), Object.fromEntries(["zh", "en", "ja"].map((locale) => [locale, Telemetry.localeCopy(locale).privacy])), "complete privacy notice");
  {
    const pipeline = Pipeline.createPipeline(options()); check("T203", pipeline.snapshot().sourceBoundary === "SYNTHETIC_TELEMETRY_NO_LIVE_GPS" && ["zh", "en", "ja"].every((locale) => Telemetry.localeCopy(locale).gps), { boundary: pipeline.snapshot().sourceBoundary, copy: Telemetry.localeCopy("en").gps }, "explicit no-live-GPS boundary");
  }
  {
    const a = await Matcher.derive(second, firstDerived, options({ provider: Providers.fixtureProvider() })); const b = await Matcher.derive(second, firstDerived, options({ provider: Providers.fixtureProvider() })); check("T204", a.derivedTelemetryHash === b.derivedTelemetryHash && JSON.stringify(Telemetry.derivedIdentity(a)) === JSON.stringify(Telemetry.derivedIdentity(b)), { first: a.derivedTelemetryHash, second: b.derivedTelemetryHash }, "deterministic fixture derivation");
  }

  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: assertions.length, assertions }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exit(1); });
