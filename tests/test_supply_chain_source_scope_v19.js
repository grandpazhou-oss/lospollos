'use strict';
const assert = require('node:assert/strict');
const Design = require('../supply-chain-design-v19.js');
const distance = (fromNodeId, toNodeId, distanceKm) => ({ fromNodeId, toNodeId, distanceKm, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_MATRIX' });
const names = ['A', 'B', 'C', 'D'];
const study = Design.createStudy({
  studyId: 'SOURCE-COVERAGE-SYNTHETIC', classification: 'SYNTHETIC',
  nodes: [{ nodeId: 'F', role: 'FACTORY' }, ...names.map(nodeId => ({ nodeId, role: 'DC' })), { nodeId: 'X', role: 'CUSTOMER' }],
  periodDemand: [{ demandId: 'DX', customerNodeId: 'X', period: '2026-01', quantity: 10, unit: 'm3', currentSiteId: 'A' }],
  distanceRows: [...names.map((id, index) => distance(id, 'X', 10 + index)), ...names.map((id, index) => distance('F', id, 20 + index))]
});
const scenario = { type: 'NETWORK_CANDIDATE', objective: 'VOLUME_KM', distanceBasis: 'VERIFIED_ROAD', facilityCounts: [1, 2, 3, 4] };
const plan = siteNodeId => ({ sourceNodeId: 'F', siteNodeId, share: 1, unit: 'm3' });
const noSource = Design.solverRequest(study, scenario);
assert.equal(noSource.objective, 'OUTBOUND_VOLUME_KM_PROXY');
assert.equal(noSource.payload.objective.pairValues.find(row => row.siteId === 'B').value, 110);
assert.throws(() => Design.solverRequest(study, { ...scenario, sourcePlan: [plan('A')] }), error => error.code === 'SUPPLY_SOURCE_COVERAGE_INCOMPLETE' && error.detail.siteIds.join(',') === 'B,C,D');
assert.throws(() => Design.solverRequest(study, { ...scenario, objectiveScope: 'OUTBOUND_ONLY', sourcePlan: [plan('A')] }), { code: 'SUPPLY_OUTBOUND_SCOPE_WITH_SOURCE_PLAN' });
const complete = Design.solverRequest(study, { ...scenario, sourcePlan: names.map(plan) });
assert.equal(complete.objective, 'TWO_END_VOLUME_KM');
assert.equal(complete.payload.objective.pairValues.find(row => row.siteId === 'B').value, 320);
const allowedOnly = Design.solverRequest(study, { ...scenario, forbiddenSiteIds: ['B', 'C', 'D'], facilityCounts: [1], sourcePlan: [plan('A')] });
assert.equal(allowedOnly.objective, 'TWO_END_VOLUME_KM');
assert.equal(allowedOnly.payload.objective.pairValues.find(row => row.siteId === 'B').value, 0);
assert.throws(() => Design.solverRequest(study, { ...scenario, sourcePlan: [{ ...plan('A'), siteNodeId: 'MISSING' }] }), { code: 'SUPPLY_SOURCE_PLAN_REFERENCE_INVALID' });
assert.throws(() => Design.solverRequest(study, { ...scenario, forbiddenSiteIds: ['A'], sourcePlan: [plan('A')] }), { code: 'SUPPLY_SOURCE_COVERAGE_INCOMPLETE' });
assert.throws(() => Design.solverRequest(study, { ...scenario, sourcePlan: [plan('A'), ...names.slice(1).map(id => ({ ...plan(id), unit: 'boxes' }))] }), { code: 'SUPPLY_SOURCE_UNIT_MISMATCH' });
assert.throws(() => Design.solverRequest(study, { ...scenario, sourcePlan: [plan('A'), { ...plan('B'), quantityByPeriod: { '2026-01': 10 } }, plan('C'), plan('D')] }), { code: 'SUPPLY_SOURCE_PERIOD_PLAN_UNSUPPORTED' });
console.log(JSON.stringify({ suite: 'SUPPLY_CHAIN_SOURCE_SCOPE_V19', status: 'PASS', noPlan: noSource.objective, partialRejected: true, complete: complete.objective, forbiddenExcluded: true }));
