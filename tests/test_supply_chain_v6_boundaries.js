'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Design = require('../supply-chain-design-v19.js');
const Joint = require('../supply-chain-joint-v19.js');
const Results = require('../supply-chain-v5-results-v19.js');

const period = '2026-01';
const road = (fromNodeId, toNodeId, distanceKm) => ({ fromNodeId, toNodeId, distanceKm, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_EXACT', strategy: 'TEST' });
const nodes = [
  { nodeId: 'S1', name: 'Source One', role: 'SUPPLIER' },
  { nodeId: 'S2', name: 'Source Two', role: 'SUPPLIER' },
  { nodeId: 'X', name: 'Unknown external', role: 'EXTERNAL' },
  { nodeId: 'W1', name: 'Warehouse One', role: 'DC', capacityByPeriod: { [period]: 20 } },
  { nodeId: 'W2', name: 'Warehouse Two', role: 'DC', capacityByPeriod: { [period]: 12 } },
  { nodeId: 'C1', name: 'Customer One', role: 'CUSTOMER' },
  { nodeId: 'C2', name: 'Customer Two', role: 'CUSTOMER' },
];
const distances = [road('S1', 'W1', 1), road('S1', 'W2', 3), road('S2', 'W1', 3), road('S2', 'W2', 1), road('W1', 'C1', 1), road('W2', 'C2', 1)];
const inbound = (knownW2, frozenW2) => [
  { flowId: 'I1', fromNodeId: 'S1', toNodeId: 'W1', period, quantity: 10, unit: 'm3' },
  { flowId: 'I2', fromNodeId: 'S2', toNodeId: 'W2', period, quantity: knownW2, unit: 'm3' },
  { flowId: 'IX', fromNodeId: 'X', toNodeId: 'W2', period, quantity: frozenW2, unit: 'm3' },
];
function study(knownW2, frozenW2, capacity = 12, extra = {}) {
  return Design.createStudy({ studyId: 'V6-INBOUND-ONLY', name: 'Synthetic inbound-only', nodes: nodes.map(row => row.nodeId === 'W2' ? { ...row, capacityByPeriod: { [period]: capacity } } : row), periodDemand: [], observedInbound: inbound(knownW2, frozenW2), distanceRows: distances, costApplicability: { inventoryHolding: 'NOT_APPLICABLE', transferTransport: 'NOT_APPLICABLE' }, ...extra });
}
const scenario = { scenarioId: 'UPSTREAM', analysisScope: 'UPSTREAM_ONLY', objective: 'VOLUME_KM', distanceBasis: 'VERIFIED_ROAD', sourceMode: 'FREE', supplierTotalMode: 'FIXED_OBSERVED', homogeneousDemandConfirmed: true, allowAllSupplierSiteEdgesConfirmed: true, timeLimitSeconds: 5, maxCandidates: 2 };
function solve(request) {
  const program = 'import json,sys,ortools;from ortools.sat.python import cp_model;from supply_chain_joint_v19 import solve_joint;print(json.dumps(solve_joint(json.load(sys.stdin),cp_model,ortools.__version__)))';
  const run = spawnSync('python3', ['-c', program], { cwd: path.join(__dirname, '../optimizer'), input: JSON.stringify(request.payload), encoding: 'utf8', timeout: 20000 });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

const complete = study(2, 10);
assert.deepEqual(complete.periods, [period]);
assert.equal(complete.periodDemand.length, 0);
const baseline = Design.evaluatePortfolio(complete, { type: 'OBSERVED_BASELINE', distanceBasis: 'VERIFIED_ROAD' });
assert.equal(baseline.metrics.inbound.totalVolume, 22);
assert.equal(baseline.metrics.totalVolumeKm, null); // Unknown external distance remains unknown.
assert.equal(baseline.capacityByPeriod.find(row => row.siteNodeId === 'W2').throughput, 12);
const request = Joint.buildRequest(complete, scenario);
assert.deepEqual(request.payload.demands, []);
assert.equal(request.payload.sites.find(row => row.id === 'W2').capacityByPeriod[period], 12);
assert.equal(request.payload.sites.find(row => row.id === 'W2').frozenByPeriod[period], 10);
const response = solve(request), verified = Joint.verify(complete, scenario, request, response);
assert.ok(verified.length);
const projected = Results.fromVerified(complete, scenario, request, verified[0], 1);
assert.equal(projected.capacityByPeriod.find(row => row.siteId === 'W2').throughput, 12);
assert.equal(projected.capacityByPeriod.find(row => row.siteId === 'W2').frozenThroughput, 10);
assert.equal(projected.capacityStatus, 'PASS');
const snapshot = Results.createSnapshot(complete, baseline, scenario, null, [projected], [{ attempted: response.attempted, feasible: response.feasible, timedOut: response.timedOut }], request);
assert.match(Results.toHtml(complete, snapshot), /固定仓网的上游覆盖/);

for (const [known, frozen, cap] of [[0, 10, 5], [3, 10, 12]]) {
  const current = study(known, frozen, cap), observed = Design.evaluatePortfolio(current, { type: 'OBSERVED_BASELINE', distanceBasis: 'VERIFIED_ROAD' });
  assert.equal(observed.capacityByPeriod.find(row => row.siteNodeId === 'W2').status, 'EXCEEDED');
  const req = Joint.buildRequest(current, scenario), solved = solve(req);
  assert.equal(solved.results[0].status, 'INFEASIBLE');
  assert.equal(Joint.verify(current, scenario, req, solved).length, 0);
}
const fake = structuredClone(response);
fake.results[0].sourceFlows = fake.results[0].sourceFlows.filter(row => row.siteId !== 'W2');
assert.throws(() => Joint.verify(complete, scenario, request, fake), { code: 'SUPPLY_JOINT_SITE_BALANCE_FAILED' });

const duplicate = study(2, 0, 12, { distanceRows: [...distances, road('S1', 'W1', 99)] });
assert.throws(() => Design.evaluatePortfolio(duplicate, { type: 'OBSERVED_BASELINE', distanceBasis: 'VERIFIED_ROAD' }), { code: 'SUPPLY_DUPLICATE_DIRECTED_DISTANCE' });
assert.throws(() => Joint.buildRequest(duplicate, scenario), { code: 'SUPPLY_DUPLICATE_DIRECTED_DISTANCE' });
const fixed = Joint.buildRequest(complete, { ...scenario, sourceMode: 'FIXED', allowAllSupplierSiteEdgesConfirmed: false, allowedSourceEdgesConfirmed: false, confirmObservedSourceRules: true });
assert.deepEqual(new Set(fixed.payload.inboundEdges.map(row => `${row.supplierId}-${row.siteId}`)), new Set(['S1-W1', 'S2-W2']));
assert.throws(() => Joint.buildRequest(complete, { ...scenario, sourceMode: 'FIXED', allowAllSupplierSiteEdgesConfirmed: false }), { code: 'SUPPLY_FIXED_SOURCE_RULES_REQUIRED' });

const rates = [{ kind: 'INBOUND_TRANSPORT', basis: 'PER_UNIT_KM', amount: 1, status: 'KNOWN' }, { kind: 'OUTBOUND_TRANSPORT', basis: 'PER_UNIT_KM', amount: 1, status: 'KNOWN' }, { kind: 'FIXED_OPERATING', fromNodeId: 'W1', toNodeId: 'W1', basis: 'PER_PERIOD', amount: 0, status: 'CONFIRMED_ZERO' }, { kind: 'HANDLING', fromNodeId: 'W1', toNodeId: 'W1', basis: 'PER_UNIT', amount: 0, status: 'CONFIRMED_ZERO' }];
const full = Design.createStudy({ studyId: 'V6-FULL', nodes, periodDemand: [{ demandId: 'D1', customerNodeId: 'C1', currentSiteId: 'W1', period, quantity: 10, unit: 'm3' }], observedInbound: inbound(0, 0), distanceRows: distances, rates, costApplicability: { inventoryHolding: 'NOT_APPLICABLE', transferTransport: 'NOT_APPLICABLE' } });
const cost = { ...scenario, analysisScope: 'FULL_CHAIN', objective: 'COST', supplierTotalMode: 'ADJUSTABLE', capacityPolicy: 'UNBOUNDED_SCREENING', facilityCounts: [1], requiredSiteIds: ['W1'], forbiddenSiteIds: ['W2'] };
assert.deepEqual(Joint.buildRequest(full, cost).payload.siteCounts, [1]);
const referenceNeedsW2 = Design.createStudy({ ...full, periodDemand: [...full.periodDemand, { demandId: 'D2', customerNodeId: 'C2', currentSiteId: 'W2', period, quantity: 1, unit: 'm3' }] });
assert.throws(() => Joint.buildRequest(referenceNeedsW2, cost, { reference: true }), { code: 'SUPPLY_COST_OBJECTIVE_INCOMPLETE' });
const costConflict = Design.createStudy({ ...full, rates: [...rates, { ...rates[0], amount: 2 }] });
assert.throws(() => Design.evaluatePortfolio(costConflict, { type: 'OBSERVED_BASELINE', distanceBasis: 'VERIFIED_ROAD' }), { code: 'SUPPLY_RATE_CONFLICT' });
assert.throws(() => Joint.buildRequest(costConflict, cost), { code: 'SUPPLY_RATE_CONFLICT' });
console.log(JSON.stringify({ suite: 'SUPPLY_CHAIN_V6_BOUNDARIES', status: 'PASS', inboundOnly: true, frozenIncluded: true, duplicateDistanceRejected: true, fixedEdgesDerived: true, forbiddenCostIgnored: true }));
