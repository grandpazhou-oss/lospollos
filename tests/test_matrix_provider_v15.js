#!/usr/bin/env node
"use strict";

const assert = require("assert");
const Matrix = require("../matrix-provider-v15.js");

const checks = [];
function check(id, condition, detail = {}) { assert(condition, `${id}: ${JSON.stringify(detail)}`); checks.push({ id, status: "PASS", detail }); }
function points() {
  return [
    { id: "A", lon: 121.40, lat: 31.20 },
    { id: "B", lon: 121.45, lat: 31.22 },
    { id: "C", lon: 121.50, lat: 31.18 },
  ];
}
function request(overrides = {}) { return { points: points(), profile: "car", distanceUnit: "km", durationUnit: "minutes", ...overrides }; }
function baseMatrix(overrides = {}) {
  return {
    providerId: "FIXTURE_MATRIX", providerVersion: "1.5.0-fixture", profile: "car",
    sourceIds: ["A", "B"], targetIds: ["A", "B"],
    distances: [[0, 4], [6, 0]], durations: [[0, 8], [12, 0]],
    distanceUnit: "km", durationUnit: "minutes", trafficMode: "FIXTURE", roadRestrictions: "FIXTURE_ONLY", departureTimeApplied: false,
    ...overrides,
  };
}

async function main() {
  const haversine = Matrix.createHaversineProvider({ roadDistanceFactor: 1.35, averageSpeedKph: 30, clock: () => "2026-08-31T00:00:00.000Z" });
  const first = await haversine.matrix(request());
  const provenance = first.provenance;
  check("T191", ["providerId", "providerVersion", "profile", "matrixHash", "pointCount", "sourceCount", "targetCount", "distanceUnit", "durationUnit", "trafficMode", "departureTimeApplied", "generatedAt", "cacheHit", "snapSummary", "unreachablePairs"].every((key) => Object.hasOwn(provenance, key)), provenance);
  const second = await haversine.matrix(request());
  check("T192", first.matrixHash === second.matrixHash, { first: first.matrixHash, second: second.matrixHash });
  const otherFactor = await Matrix.createHaversineProvider({ roadDistanceFactor: 1.36, averageSpeedKph: 30, clock: () => "2026-08-31T00:00:00.000Z" }).matrix(request());
  check("T193", first.matrixHash !== otherFactor.matrixHash, { first: first.matrixHash, other: otherFactor.matrixHash });

  const fixture = {
    sourceIds: ["A", "B", "C"], targetIds: ["A", "B", "C"],
    profiles: {
      car: {
        sourceIds: ["A", "B", "C"], targetIds: ["A", "B", "C"],
        distances: [[0, 4, 20], [6, 0, 3], [Infinity, 5, 0]],
        durations: [[0, 8, 40], [12, 0, 6], [Infinity, 10, 0]],
        trafficMode: "FIXTURE", roadRestrictions: "CAR_FIXTURE", unreachablePolicy: "ALLOW_INFINITY",
      },
      truck: {
        sourceIds: ["A", "B", "C"], targetIds: ["A", "B", "C"],
        distances: [[0, 7, 25], [8, 0, 6], [30, 9, 0]],
        durations: [[0, 14, 50], [16, 0, 12], [60, 18, 0]],
        trafficMode: "FIXTURE", roadRestrictions: "TRUCK_FIXTURE",
      },
    },
    routes: { "car:A:B": { distance: 4.1, duration: 8.2, geometry: [[121.40, 31.20], [121.45, 31.22]] } },
  };
  const fixtureProvider = Matrix.createFixtureProvider(fixture);
  const fixtureMatrix = await fixtureProvider.matrix(request());
  check("T194", fixtureMatrix.provenance.asymmetry.asymmetric === true && fixtureMatrix.provenance.asymmetry.pairs.length > 0, fixtureMatrix.provenance.asymmetry);
  check("T195", fixtureMatrix.unreachablePairs.some((pair) => pair.sourceId === "C" && pair.targetId === "A") && fixtureMatrix.distances[2][0] === null, fixtureMatrix.unreachablePairs);

  const negative = Matrix.validateMatrix(baseMatrix({ distances: [[0, -1], [2, 0]] }));
  check("T196", negative.status === "FAIL" && negative.error.code === "MATRIX_VALUE_NEGATIVE", negative);
  const nan = Matrix.validateMatrix(baseMatrix({ distances: [[0, NaN], [2, 0]] }));
  check("T197", nan.status === "FAIL" && nan.error.code === "MATRIX_VALUE_NAN", nan);
  const infinityAllowed = Matrix.validateMatrix(baseMatrix({ distances: [[0, Infinity], [2, 0]], durations: [[0, Infinity], [4, 0]] }), { unreachablePolicy: "ALLOW_INFINITY" });
  check("T198", infinityAllowed.status === "PASS" && infinityAllowed.matrix.distances[0][1] === null && infinityAllowed.unreachablePairs.length === 1, infinityAllowed);
  const dimensions = Matrix.validateMatrix(baseMatrix({ distances: [[0], [2, 0]] }));
  check("T199", dimensions.status === "FAIL" && dimensions.error.code === "MATRIX_DIMENSION_MISMATCH", dimensions);
  const diagonalWarn = Matrix.validateMatrix(baseMatrix({ distances: [[1, 4], [6, 0]] }), { diagonalPolicy: "WARN" });
  const diagonalReject = Matrix.validateMatrix(baseMatrix({ distances: [[1, 4], [6, 0]] }), { diagonalPolicy: "REJECT" });
  check("T200", diagonalWarn.status === "PASS" && diagonalWarn.warnings.some((row) => row.code === "MATRIX_DIAGONAL_NONZERO") && diagonalReject.error.code === "MATRIX_DIAGONAL_NONZERO", { diagonalWarn, diagonalReject });
  const missingUnits = Matrix.validateMatrix(baseMatrix({ distanceUnit: "", durationUnit: "" }));
  check("T201", missingUnits.status === "FAIL" && missingUnits.error.code === "MATRIX_UNITS_REQUIRED", missingUnits);
  const missingProfile = Matrix.validateMatrix(baseMatrix({ profile: "" }));
  check("T202", missingProfile.status === "FAIL" && missingProfile.error.code === "MATRIX_PROFILE_REQUIRED", missingProfile);
  check("T203", first.providerVersion === "1.5.0" && provenance.providerVersion === "1.5.0", provenance);
  check("T204", first.departureTimeApplied === false && typeof first.provenance.departureTimeApplied === "boolean", first.provenance);
  check("T205", first.trafficMode === "NONE" && first.provenance.trafficMode === "NONE", first.provenance);

  const osrm = Matrix.createExternalProvider("OSRM_COMPATIBLE");
  const valhalla = Matrix.createExternalProvider("VALHALLA_COMPATIBLE");
  check("T206", osrm.availability === "DISABLED", { availability: osrm.availability });
  check("T207", valhalla.availability === "DISABLED", { availability: valhalla.availability });
  await assert.rejects(() => osrm.matrix(request()), (caught) => caught.code === "EXTERNAL_PROVIDER_DISABLED");
  const enabledNoEndpoint = Matrix.createExternalProvider("OSRM_COMPATIBLE", { enabled: true, coordinateDisclosureAccepted: true, fetch: async () => ({}) });
  await assert.rejects(() => enabledNoEndpoint.matrix(request()), (caught) => caught.code === "EXTERNAL_PROVIDER_ENDPOINT_REQUIRED");
  check("T208", osrm.networkCalls === 0 && enabledNoEndpoint.networkCalls === 0, { disabled: osrm.networkCalls, noEndpoint: enabledNoEndpoint.networkCalls });
  const disclosureGate = Matrix.createExternalProvider("VALHALLA_COMPATIBLE", { enabled: true, endpoint: "http://configured.invalid", fetch: async () => ({}) });
  let privacyError = null;
  try { await disclosureGate.matrix(request()); } catch (caught) { privacyError = caught; }
  check("T209", privacyError?.code === "COORDINATE_DISCLOSURE_REQUIRED" && privacyError.message === Matrix.PRIVACY_NOTICE && disclosureGate.networkCalls === 0, { code: privacyError?.code, message: privacyError?.message, networkCalls: disclosureGate.networkCalls });

  const stale = { ...first, matrixHash: "fnv1a64:stale" };
  const staleValidation = Matrix.validateMatrix(stale);
  check("T210", staleValidation.status === "FAIL" && staleValidation.error.code === "MATRIX_HASH_STALE", staleValidation);
  const subset = await fixtureProvider.matrix({ sources: [points()[2], points()[0]], targets: [points()[1]], profile: "car", distanceUnit: "km", durationUnit: "minutes" });
  check("T211", JSON.stringify(subset.sourceIds) === JSON.stringify(["C", "A"]) && JSON.stringify(subset.targetIds) === JSON.stringify(["B"]) && subset.distances[0][0] === 5 && subset.distances[1][0] === 4, subset);
  check("T212", second.cacheHit === true && second.provenance.cacheHit === true && second.matrixHash === first.matrixHash, second.provenance);
  const sampleRoute = await fixtureProvider.route({ source: points()[0], target: points()[1], profile: "car", distanceUnit: "km", durationUnit: "minutes" });
  const samplePass = Matrix.sampleRouteConsistency(fixtureMatrix, { ...sampleRoute, sourceId: "A", targetId: "B" }, { tolerance: .2 });
  const sampleFail = Matrix.sampleRouteConsistency(fixtureMatrix, { ...sampleRoute, sourceId: "A", targetId: "B", distance: 5 }, { tolerance: .2 });
  check("T213", samplePass.status === "PASS" && sampleFail.status === "MISMATCH" && samplePass.tolerance === .2, { samplePass, sampleFail });
  check("T214", fixtureMatrix.provenance.metricity.nonMetric === true && fixtureMatrix.provenance.metricity.violations.length > 0, fixtureMatrix.provenance.metricity);
  const solverRequest = Matrix.attachToSolverRequest({ requestHash: "REQ-1" }, fixtureMatrix);
  check("T215", solverRequest.matrixProvider.id === "FIXTURE_MATRIX" && solverRequest.matrixProvider.version === fixtureMatrix.providerVersion && solverRequest.matrixProvider.matrixHash === fixtureMatrix.matrixHash, solverRequest);

  process.stdout.write(`${JSON.stringify({ status: "PASS", checks: checks.length, ids: checks.map((row) => row.id) }, null, 2)}\n`);
}

main().catch((caught) => { process.stderr.write(`${caught.stack || caught.message}\n`); process.exit(1); });
