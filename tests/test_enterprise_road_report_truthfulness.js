'use strict';
// Actual production modules; all data and road responses below are synthetic.
// No real OSRM, native solver, browser, socket, or external network is used.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Road = require('../local-road-client-v86.js');
const Controller = require('../supply-chain-controller-v19.js');
const Design = require('../supply-chain-design-v19.js');
const Report = require('../supply-chain-report-v19.js');
const Explanation = require('../supply-chain-explanation-v19.js');
const MapProjection = require('../platform-supply-map-v8.js');
const clone = value => structuredClone(value);
const coords = [[110, 30], [111, 30]];
const roadConfig = { roadNetworkVersion: 'SYNTHETIC_NETWORK_NO_REAL_OSRM' };
const body = (distance = 12000) => ({
  code: 'Ok', routes: [{ distance, duration: 900 }],
  waypoints: coords.map(location => ({ location: [...location], distance: 0 }))
});
const reply = value => ({ ok: true, json: async () => value });
const roadRow = async () => Road.route(clone(coords), {
  ...roadConfig, coordinateUse: 'WGS84', fetch: async () => reply(body())
});
const roadStudy = distanceRows => ({
  studyId: 'SYNTHETIC_ROAD_TRUTH', classification: 'SYNTHETIC_TEST', coordinateUse: 'WGS84',
  nodes: [{ nodeId: 'A', role: 'DC', coordinate: coords[0] }, { nodeId: 'C', role: 'CUSTOMER', coordinate: coords[1] }],
  periodDemand: [{ demandId: 'D', customerNodeId: 'C', currentSiteId: 'A', period: 'P', quantity: 10, unit: 'm3' }],
  distanceRows
});

const edge = (fromNodeId, toNodeId, distanceKm, quality = 'VERIFIED_ROAD') => ({
  fromNodeId, toNodeId, distanceKm, unit: 'km', quality, source: 'SYNTHETIC_TEST_NOT_ACTUAL_ROADS'
});
const rawStudy = overrides => ({
  studyId: 'SYNTHETIC_REPORT_TRUTH', classification: 'SYNTHETIC_TEST', currency: 'CNY',
  nodes: [
    { nodeId: 'S', role: 'SUPPLIER' },
    { nodeId: 'A', role: 'DC', capacityByPeriod: { P: 100 } },
    { nodeId: 'B', role: 'DC', capacityByPeriod: { P: 100 } },
    { nodeId: 'C1', role: 'CUSTOMER' }, { nodeId: 'C2', role: 'CUSTOMER' }
  ],
  periodDemand: [1, 2].map(i => ({ demandId: 'D' + i, customerNodeId: 'C' + i, currentSiteId: 'A', period: 'P', quantity: 10, unit: 'm3' })),
  observedInbound: [{ flowId: 'I', fromNodeId: 'S', toNodeId: 'A', period: 'P', quantity: 20, unit: 'm3' }],
  distanceRows: [edge('A', 'C1', 100), edge('A', 'C2', 100), edge('B', 'C1', 1), edge('B', 'C2', 1), edge('S', 'A', 2), edge('S', 'B', 2)],
  costApplicability: { inventoryHolding: 'NOT_APPLICABLE', transferTransport: 'NOT_APPLICABLE' },
  ...overrides
});
const scenario = {
  scenarioId: 'SYNTHETIC_PLAN', type: 'NETWORK_CANDIDATE', objective: 'VOLUME_KM',
  objectiveScope: 'OUTBOUND_ONLY', distanceBasis: 'VERIFIED_ROAD', selectedSiteIds: ['B'],
  facilityCounts: [1], sourcePlan: [{ sourceNodeId: 'S', siteNodeId: 'B', share: 1 }]
};
function report(overrides = {}, scenarioPatch = {}, runs = []) {
  const study = Design.createStudy(rawStudy(overrides));
  const baseline = Design.evaluatePortfolio(study, { type: 'OBSERVED_BASELINE', distanceBasis: 'VERIFIED_ROAD' });
  const config = { ...scenario, ...scenarioPatch };
  const candidate = Design.evaluatePortfolio(study, config, [1, 2].map(i => ({ demandId: 'D' + i, siteId: 'B' })));
  return { study, baseline, candidate, snapshot: Report.createSnapshot(study, baseline, [candidate], runs, config) };
}

test('road reuse binds network, CRS, direction, profile, endpoint, assumptions, snaps and time', async t => {
  const row = await roadRow();
  const now = Date.parse(row.observedAt);
  assert.equal(row.quality, 'ESTIMATED_ROAD');
  assert.equal(row.evidence.profile, 'driving');
  assert.equal(row.evidence.truckRestrictions, 'NOT_VERIFIED');
  assert.equal(row.evidence.verification, 'ENGINE_CALCULATED_NOT_MANUALLY_VERIFIED');
  assert.equal(Road.reuseAssessment(row, ...coords, 'WGS84', roadConfig, now).reusable, true);
  const mutations = [
    ['network', r => { r.evidence.networkVersion = 'different'; }],
    ['CRS', r => { r.evidence.coordinateUse = 'ASSUMED_WGS84_SCREENING'; }],
    ['direction', r => { r.evidence.requestedCoordinates.reverse(); }],
    ['coordinates', r => { r.evidence.requestedCoordinates[0][0] += 0.00001; }],
    ['profile', r => { r.evidence.profile = 'truck'; }],
    ['endpoint', r => { r.evidence.endpoint = 'http://localhost:5001'; }],
    ['source', r => { r.source = 'IMPORTED'; }],
    ['strategy', r => { r.strategy = 'TABLE'; }],
    ['unit', r => { r.unit = 'm'; }],
    ['promotion', r => { r.quality = 'VERIFIED_ROAD'; }],
    ['distance', r => { r.distanceKm = -1; }],
    ['duration', r => { r.travelSeconds = null; }],
    ['missing evidence', r => { delete r.evidence; }],
    ['missing snaps', r => { delete r.evidence.snappedCoordinates; }],
    ['reported snap', r => { r.evidence.snapMeters[0] = 1001; }],
    ['measured snap', r => { r.evidence.measuredSnapMeters[0] = 1001; }],
    ['false snap', r => { r.evidence.snappedCoordinates[0] = [100, 20]; }],
    ['verification', r => { r.evidence.verification = 'VERIFIED'; }],
    ['truck claim', r => { r.evidence.truckRestrictions = 'VERIFIED'; }],
    ['traffic claim', r => { r.evidence.traffic = 'MODELED'; }],
    ['expired', r => { r.observedAt = '2000-01-01T00:00:00.000Z'; }],
    ['future', r => { r.observedAt = new Date(now + 1).toISOString(); }],
    ['invalid date', r => { r.observedAt = 'unknown'; }]
  ];
  for (const [name, mutate] of mutations) await t.test(name, () => {
    const changed = clone(row); mutate(changed);
    assert.equal(Road.reuseAssessment(changed, ...coords, 'WGS84', roadConfig, now).reusable, false);
  });
  assert.equal(Road.reuseAssessment(row, ...coords, 'WGS84', {}, now).reason, 'ROAD_NETWORK_VERSION_REQUIRED');
  assert.equal(Road.reuseAssessment(row, ...coords, 'UNCONFIRMED', roadConfig, now).reusable, false);
  assert.equal(Road.reuseAssessment(row, ...coords, 'WGS84', { ...roadConfig, roadReuseMaxAgeMs: 1000 }, now + 1000).reusable, true);
  assert.equal(Road.reuseAssessment(row, ...coords, 'WGS84', { ...roadConfig, roadReuseMaxAgeMs: 1000 }, now + 1001).reason, 'ROAD_EVIDENCE_EXPIRED');
});

test('route captures coordinate and CRS provenance before async dispatch', async () => {
  const requestCoords = clone(coords), requestOptions = { ...roadConfig, coordinateUse: 'WGS84' };
  let resolve, dispatched;
  requestOptions.fetch = url => { dispatched = url; return new Promise(done => { resolve = done; }); };
  const pending = Road.route(requestCoords, requestOptions);
  requestCoords[0][0] += 0.001;
  requestOptions.coordinateUse = 'ASSUMED_WGS84_SCREENING';
  resolve(reply(body()));
  const result = await pending;
  assert.match(dispatched, /110\.000000,30\.000000/);
  assert.deepEqual(result.evidence.requestedCoordinates, coords);
  assert.equal(result.evidence.coordinateUse, 'WGS84');
  assert.equal(Road.reuseAssessment(result, ...requestCoords, 'WGS84', roadConfig).reusable, false);
  requestCoords[1][0] += 0.001;
  assert.deepEqual(result.evidence.requestedCoordinates, coords);
});

test('expired local rows regenerate and fresh equivalent rows suppress requests', async () => {
  const row = { ...await roadRow(), fromNodeId: 'A', toNodeId: 'C' };
  for (const expired of [false, true]) {
    let calls = 0;
    const c = Controller.createController({ roadConfig, fetch: async () => { calls++; return reply(body(22000)); } });
    c.loadStudy(roadStudy([{ ...row, observedAt: expired ? '2000-01-01T00:00:00.000Z' : row.observedAt }]));
    const result = await c.generateRoadDistances();
    assert.equal(result.status, 'COMPLETE');
    assert.equal(calls, expired ? 1 : 0);
    assert.equal(c.viewState().study.distanceRows.length, 1);
    assert.equal(c.viewState().study.distanceRows[0].distanceKm, expired ? 22 : 12);
  }
});

test('missing road service, coordinates and CRS confirmation remain explicit without fallback', async () => {
  const c = Controller.createController({ roadConfig, fetch: async () => { throw new TypeError('Synthetic service offline'); } });
  c.loadStudy(roadStudy([]));
  const unavailable = await c.generateRoadDistances();
  assert.equal(unavailable.status, 'PARTIAL');
  assert.equal(unavailable.failures[0].code, 'ROAD_CONNECTION_FAILED');
  assert.equal(c.viewState().study.distanceRows.length, 0);
  let calls = 0;
  const missing = await Road.matrix({ coordinateUse: 'WGS84' }, [[{ nodeId: 'A' }, { nodeId: 'C', coordinate: coords[1] }]], { ...roadConfig, fetch: () => { calls++; } });
  assert.equal(missing.failures[0].code, 'ROAD_COORDINATE_INVALID');
  await assert.rejects(Road.route(coords, { coordinateUse: 'UNCONFIRMED', fetch: () => { calls++; } }), { code: 'ROAD_COORDINATE_SYSTEM_UNCONFIRMED' });
  await assert.rejects(Road.route(coords, { coordinateUse: 'WGS84', roadProfile: 'truck', fetch: () => { calls++; } }), { code: 'ROAD_PROFILE_UNSUPPORTED' });
  assert.equal(calls, 0);
});

test('affected report distances use common known customer-period records', () => {
  const { study, snapshot } = report({ distanceRows: [edge('A', 'C1', 100), edge('B', 'C2', 1)] });
  assert.equal(snapshot.rows[0].affectedCustomers.before.weightedDistanceKm, null);
  assert.equal(snapshot.rows[0].affectedCustomers.after.weightedDistanceKm, null);
  assert.equal(snapshot.rows[0].affectedCustomers.before.coverageRatio, 0);
  assert.equal(snapshot.rows[0].affectedCustomers.after.coverageRatio, 0);
  assert.ok(!Report.toMarkdown(study, snapshot).includes('100 → 1'));
  assert.equal(snapshot.recommendation, null);
  const common = report({ distanceRows: [edge('A', 'C1', 100), edge('B', 'C1', 50), edge('B', 'C2', 1)] }).snapshot;
  assert.equal(common.rows[0].affectedCustomers.before.weightedDistanceKm, 100);
  assert.equal(common.rows[0].affectedCustomers.after.weightedDistanceKm, 50);
  assert.equal(common.rows[0].affectedCustomers.after.coverageRatio, 0.5);
});

test('reports suppress change rates across different road-distance bases', () => {
  const distances = [edge('A', 'C1', 100), edge('A', 'C2', 100), edge('B', 'C1', 1, 'ESTIMATED_ROAD'), edge('B', 'C2', 1, 'ESTIMATED_ROAD')];
  const { study, snapshot } = report({ distanceRows: distances }, { distanceBasis: 'ESTIMATED_ROAD' });
  assert.equal(snapshot.rows[0].comparison.sameScope, false);
  assert.equal(snapshot.explanation.rows[0].outbound.comparable, false);
  assert.equal(snapshot.explanation.rows[0].outbound.changeRate, null);
  assert.equal(snapshot.explanation.rows[0].outbound.changeKm, null);
  assert.equal(snapshot.rows[0].affectedCustomers.before.weightedDistanceKm, null);
  assert.equal(snapshot.rows[0].affectedCustomers.after.weightedDistanceKm, null);
  assert.ok(!Report.toMarkdown(study, snapshot).includes('100 → 1'));
  assert.equal(snapshot.recommendation, null);
  assert.ok(!Report.toHtml(study, snapshot, 'en').includes('-99%'));
});

test('frequency metadata cannot turn volume-km into vehicle-km or cost savings', () => {
  const { snapshot } = report();
  for (const frequencyKnown of [false, true]) {
    const brief = { ...Explanation.businessBrief(snapshot), frequencyKnown };
    const text = Explanation.describeBrief(brief, 'en').join('\n');
    assert.doesNotMatch(text, /rankings can be read in vehicle-km|upgrades this to vehicle-km|rankings and distances use/);
    assert.match(text, /volume-km/);
    assert.match(text, /no savings claim/);
    if (frequencyKnown) assert.match(text, /separate calculation/);
    else assert.match(text, /Weighted distance remains in km/);
  }
});

test('missing rates, baseline and carbon do not create financial or carbon gains', () => {
  const { study, snapshot } = report();
  const brief = Explanation.businessBrief(snapshot);
  assert.equal(brief.costBefore, null); assert.equal(brief.costAfter, null);
  assert.equal(snapshot.rows[0].comparison.steadyStateImprovementRate, null);
  assert.equal(snapshot.decision.kind, 'THEORETICAL_DISTANCE_SCREENING');
  assert.equal(snapshot.recommendation, null);
  assert.match(Report.toHtml(study, snapshot, 'en'), /no savings claim/);
  assert.ok(!Object.keys(snapshot.rows[0].result.metrics).some(key => /carbon|emission/i.test(key)));
  const missing = report({ periodDemand: rawStudy().periodDemand.map(row => ({ ...row, currentSiteId: null })) }).snapshot;
  assert.equal(missing.recommendation, null);
  assert.equal(missing.rows[0].comparison.steadyStateImprovementRate, null);
  assert.equal(Explanation.businessBrief(missing).outboundRate, undefined);
});

test('limited synthetic candidate set stays limited and exposes unsuccessful solve statuses', () => {
  const results = [
    { status: 'FEASIBLE', facilityCount: 1, rank: 1 },
    { status: 'INFEASIBLE', facilityCount: 2, rank: 2, reasonCode: 'SYNTHETIC_CONSTRAINT_CONFLICT' },
    { status: 'TIME_LIMIT', facilityCount: 3, rank: 3, reasonCode: 'SYNTHETIC_TIME_LIMIT' }
  ];
  const { study, snapshot } = report({}, { topK: 5 }, [{ scenarioId: scenario.scenarioId, results }]);
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.explanation.solver.displayed, 1);
  assert.equal(snapshot.explanation.solver.infeasible, 1);
  assert.equal(snapshot.explanation.solver.timedOut, 1);
  assert.equal(snapshot.explanation.solver.attempted, 3);
  assert.match(Report.toMarkdown(study, snapshot), /SYNTHETIC_CONSTRAINT_CONFLICT/);
  assert.match(Report.toHtml(study, snapshot, 'en'), /Infeasible 1/);
});

test('comparison refuses mixed periods or units and uses applicable rate bases', () => {
  const { study, baseline, candidate } = report();
  const known = [
    { demandId: 'D', period: 'P1', quantity: 10, volumeKm: 100, unit: 'm3' },
    { demandId: 'D', period: 'P2', quantity: 10, volumeKm: 100, unit: 'm3' }
  ];
  const other = known.map((row, i) => ({ ...row, quantity: i ? 15 : 5, volumeKm: i ? 150 : 50 }));
  assert.equal(Design.commonDistance(known, other).sampleCount, 0);
  assert.equal(Design.commonDistance(known, known.map(row => ({ ...row, unit: 'kg' }))).sampleCount, 0);
  assert.throws(() => Design.createStudy(rawStudy({ periodDemand: rawStudy().periodDemand.map((row, i) => ({ ...row, unit: i ? 'kg' : 'm3' })) })), { code: 'SUPPLY_MIXED_DEMAND_UNITS' });
  assert.equal(Design.amountFor({ status: 'KNOWN', basis: 'PER_UNIT_KM', amount: 2 }, 10, 3), 60);
  assert.equal(Design.amountFor({ status: 'KNOWN', basis: 'PER_UNIT', amount: 2 }, 10, 3), 20);
  assert.equal(Design.amountFor({ status: 'KNOWN', basis: 'UNKNOWN', amount: 2 }, 10, 3), null);
  const altered = clone(candidate); altered.scope.periods = ['ANOTHER_PERIOD']; delete altered.resultHash; altered.resultHash = Design.hash(altered);
  assert.equal(Design.compare(study, baseline, altered).sameScope, false);
});

test('rendered cost formula respects rate bases without rewriting stored metadata', () => {
  const rates = [
    { kind: 'INBOUND_TRANSPORT', basis: 'PER_PERIOD', amount: 20, status: 'KNOWN' },
    { kind: 'OUTBOUND_TRANSPORT', basis: 'PER_UNIT', amount: 3, status: 'KNOWN' },
    { kind: 'FIXED_OPERATING', basis: 'PER_PERIOD', amount: 0, status: 'CONFIRMED_ZERO' },
    { kind: 'HANDLING', basis: 'PER_UNIT', amount: 0, status: 'CONFIRMED_ZERO' }
  ];
  const { study, snapshot } = report({ rates }, { objective: 'COST' });
  assert.equal(snapshot.baseline.metrics.steadyStateCost, 80);
  assert.equal(snapshot.rows[0].result.metrics.steadyStateCost, 80);
  const original = JSON.stringify(snapshot);
  assert.equal(snapshot.formulae.transportCost, 'sum(quantity × directed distance km × applicable rate)');
  for (const text of [Report.toMarkdown(study, snapshot), ...['zh', 'en', 'ja'].map(locale => Report.toHtml(study, snapshot, locale))]) {
    assert.match(text, /PER_UNIT_KM/); assert.match(text, /PER_UNIT/); assert.match(text, /PER_PERIOD/);
    assert.ok(!text.includes(snapshot.formulae.transportCost));
  }
  assert.equal(JSON.stringify(snapshot), original);
  const reopened = JSON.parse(original); Report.assertCurrent(study, reopened);
  assert.equal(JSON.stringify(reopened), original);
});

test('map lines retain business-relation provenance and never claim truck routes', () => {
  const { study, snapshot } = report({ coordinateUse: 'WGS84', nodes: rawStudy().nodes.map((node, i) => ({ ...node, coordinateSystem: 'WGS84', coordinate: [110 + i / 10, 30] })) });
  const original = JSON.stringify({ study, snapshot });
  const model = MapProjection.project(study, snapshot, 'en');
  assert.equal(model.provenance.geometry, 'BUSINESS_RELATION_ONLY_NOT_ROAD_ROUTE');
  assert.match(model.legend, /business relations, not road routes/);
  assert.ok(model.features.some(feature => feature.geometry.type === 'LineString'));
  assert.ok(model.features.filter(feature => feature.geometry.type === 'LineString').every(feature => feature.properties.kind === 'assignment'));
  assert.equal(JSON.stringify({ study, snapshot }), original);
});

console.log('Evidence method: REAL_MODULES_SYNTHETIC_INPUTS_CONTROLLED_ROAD_RESPONSES; no real OSRM, native solver, or browser claim');
