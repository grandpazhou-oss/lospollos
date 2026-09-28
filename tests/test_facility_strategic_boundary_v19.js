const assert = require('node:assert/strict');
const Facility = require('../facility-location-mvp1-v19.js');
const Explanation = require('../facility-recommendation-explanation-v19.js');
const Data = require('../design-data-adapter-v19.js');

const input = {
  studyId: 'STRATEGIC-BOUNDARY-SYNTHETIC', coordinateSystem: 'WGS84', observationPeriod: 'MODEL_RUN',
  demands: [{ demandId: 'D1', coordinate: [117, 39], demand: { quantity: 1, weight: 0, volume: 2 }, periodDemand: [{ period: 'P1', volume: 2 }] }],
  sites: [{ siteId: 'S1', coordinate: [117, 39], fixedCost: 10, handlingCostPerUnit: 2 }],
  options: { facilityCounts: [1], transportBasis: 'volume', transportCostPerUnitKm: 3, currency: 'CNY', costPeriod: 'MODEL_RUN' },
  currentPortfolio: { selectedSiteIds: ['S1'] },
  matrix: { mode: 'IMPORTED_IMPEDANCE_MATRIX', providerId: 'SYNTHETIC_TEST', providerVersion: '1', rows: [{ siteId: 'S1', demandId: 'D1', distanceMeters: 1000, travelSeconds: 60, unreachable: false }] },
  periodDemand: [{ demandId: 'D1', period: 'P1', volume: 2 }],
  observedInbound: [{ sourceId: 'F1', targetId: 'S1', volume: 2 }],
  observedAssignments: [{ demandId: 'D1', siteId: 'S1' }]
};
const study = Facility.normalizeStudy(input);
const matrix = Facility.buildMatrix(study);
assert.deepEqual(study.sites[0].capacity, { quantity: null, weight: null, volume: null });
assert.deepEqual(study.demands[0].periodDemand, input.demands[0].periodDemand);
for (const key of ['periodDemand', 'observedInbound', 'observedAssignments']) assert.deepEqual(study[key], input[key]);
assert.equal(Facility.normalizeStudy(study).studyHash, study.studyHash);

const preflight = Facility.preflight(study, matrix);
assert.equal(preflight.status, 'PASS');
assert.equal(preflight.capacityValidation, 'INCOMPLETE_UNKNOWN_CAPACITY');
const request = Facility.createRequest(study, matrix);
assert.deepEqual(request.sites[0].capacity, study.sites[0].capacity);
assert.equal(request.capacityValidation, 'INCOMPLETE_UNKNOWN_CAPACITY');
assert.equal(request.options.currentPortfolioKind, 'FIXED_SITE_REASSIGNMENT');
for (const key of ['periodDemand', 'observedInbound', 'observedAssignments']) assert.deepEqual(request[key], input[key]);
assert.equal(Facility.bruteForceOracle(study, matrix, 1).objectiveValue, 20);
assert.equal(Facility.bruteForceOracle(study, matrix, 1).capacityValidation, 'INCOMPLETE_UNKNOWN_CAPACITY');

const result = { facilityCount: 1, rank: 1, status: 'OPTIMAL', selectedSiteIds: ['S1'], assignments: [{ demandId: 'D1', siteId: 'S1', distanceMeters: 1000, basisAmount: 2 }], serviceRate: 1, cost: { currency: 'CNY', period: 'MODEL_RUN', fixed: 10, handling: 4, transport: 6, total: 20 }, objectiveValue: 20, bestBound: 20 };
const resultSet = { schemaVersion: Facility.RESULT_SCHEMA, requestId: 'SYNTHETIC-TEST', studyHash: study.studyHash, resultSetHash: 'sha256:synthetic-test', engine: { id: 'OR_TOOLS_CP_SAT', version: 'synthetic-test', workers: 1, randomSeed: 1909 }, currentBaseline: { ...result, rank: 0, portfolioKind: 'CURRENT_NETWORK_BASELINE' }, results: [result] };
const verification = Facility.verifyResult(study, matrix, resultSet);
assert.equal(verification.status, 'PASS');
assert.equal(verification.capacityValidation, 'INCOMPLETE_UNKNOWN_CAPACITY');
assert.equal(verification.baselineKind, 'FIXED_SITE_REASSIGNMENT');
const recommendation = Facility.summarize(study, matrix, resultSet, verification);
assert.equal(recommendation.current.portfolioKind, 'FIXED_SITE_REASSIGNMENT');
assert.equal(recommendation.observedBaseline, null);
assert.equal(recommendation.observedBaselineStatus, 'NOT_COMPUTED');
assert.equal(recommendation.comparison.observedBaselineComparable, false);
const html = Explanation.report({ study, matrix, resultSet, verification, recommendation });
assert.match(html, /固定仓名单下重分配候选/);
assert.doesNotMatch(html, /方案减现状/);

const knownInsufficient = structuredClone(study);
knownInsufficient.sites[0].capacity.volume = 1;
assert.equal(Facility.bruteForceOracle(knownInsufficient, matrix, 1).status, 'INFEASIBLE');
const invalid = structuredClone(study);
invalid.sites[0].capacity.volume = '';
assert.throws(() => Facility.normalizeStudy(invalid), { code: 'FACILITY_CAPACITY_INVALID' });

const legacy = Facility.fromScenario(Data.createSyntheticStudy({ orderCount: 12, depotCount: 5, vehicleCount: 20 }).scenario, { facilityCounts: [1, 2, 3] });
assert.equal(legacy.studyHash, 'sha256:12cfbbfeca01f16f1c4cccfcc438d267622ff9d9dad3e3074b3b6e765b468844');
const legacyExplicit = structuredClone(legacy);
legacyExplicit.sites[0].capacity.volume = Number.MAX_SAFE_INTEGER;
assert.equal(Facility.normalizeStudy(legacyExplicit).studyHash, 'sha256:13bf8ad2fcdd664c833f6e41570263ecb0373c94096bb14ea809b204e62067fd');

console.log(JSON.stringify({ suite: 'FACILITY_STRATEGIC_BOUNDARY_V19', status: 'PASS', checks: 29 }));
