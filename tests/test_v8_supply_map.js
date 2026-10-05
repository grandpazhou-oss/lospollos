'use strict';
const assert = require('node:assert/strict');
const map = require('../platform-supply-map-v8.js');

const study = {
  studyId: 'S', inputHash: 'H', unit: 'm3', coordinateUse: 'ASSUMED_WGS84_SCREENING',
  nodes: [
    { nodeId: 'P', name: 'Factory', role: 'FACTORY', coordinate: [118, 31], coordinateSystem: 'UNCONFIRMED' },
    { nodeId: 'W', name: 'Depot', role: 'DC', coordinate: [119, 31], coordinateSystem: 'UNCONFIRMED' },
    { nodeId: 'C', name: 'Customer', role: 'CUSTOMER', coordinate: [120, 31], coordinateSystem: 'UNCONFIRMED' },
    { nodeId: 'X', name: 'Unknown source', role: 'EXTERNAL_SOURCE', coordinate: null, coordinateSystem: null }
  ]
};
const snapshot = {
  studyHash: 'H', snapshotHash: 'R', distanceBasis: 'GEOGRAPHIC_SCREENING',
  decision: { focusScenarioId: 'candidate-2' },
  rows: [{ scenarioId: 'candidate-2', status: 'EVALUATED', selectedSites: [{ nodeId: 'W' }],
    inbound: [{ fromNodeId: 'P', toNodeId: 'W', period: '2026-01', quantity: 3 }, { fromNodeId: 'P', toNodeId: 'W', period: '2026-02', quantity: 4 }],
    outbound: [{ fromNodeId: 'W', toNodeId: 'C', period: '2026-01', quantity: 3 }, { fromNodeId: 'W', toNodeId: 'C', period: '2026-02', quantity: 4 }]
  }]
};

const result = map.project(study, snapshot, 'zh');
assert.equal(result.owner, 'SUPPLY');
assert.equal(result.provenance.focusScenarioId, 'candidate-2');
assert.equal(result.features.filter(feature => feature.geometry.type === 'LineString').length, 2, 'Period records aggregate to two business relations');
assert.ok(result.entities.some(entity => entity.id === 'X' && entity.summary.includes('仅在列表显示')));
assert.equal(result.features.some(feature => feature.properties.entityId === 'X'), false, 'Unknown coordinate is never drawn at zero');
assert.match(result.legend, /不是道路路线/);
assert.match(result.entities.find(entity => entity.id === 'W').facts.find(row => row[0] === '供应商→仓供货关系')[1], /^7(?:\s|$)/);
assert.match(result.entities.find(entity => entity.id === 'W').facts.find(row => row[0] === '仓→送货地分配关系')[1], /^7(?:\s|$)/);

const stale = map.project(study, { ...snapshot, studyHash: 'OLD' }, 'en');
assert.equal(stale.provenance.snapshotHash, null);
assert.equal(stale.provenance.focusScenarioId, null);
assert.equal(stale.features.filter(feature => feature.geometry.type === 'LineString').length, 0, 'Stale snapshot cannot supply relations');

const unconfirmed = map.project({ ...study, coordinateUse: 'UNCONFIRMED' }, snapshot, 'ja');
assert.equal(unconfirmed.features.length, 0, 'Unconfirmed coordinates are listed but not mapped');
assert.equal(unconfirmed.entities.length, study.nodes.length);

const compareStudy = { ...study, nodes: [
  ...study.nodes,
  { nodeId: 'E', name: 'East Depot', role: 'DC', coordinate: [119.5, 31], coordinateSystem: 'WGS84' }
], periods: ['2026-01', '2026-02'] };
const oldInbound = [{ fromNodeId: 'P', toNodeId: 'W', period: '2026-01', quantity: 3 }, { fromNodeId: 'P', toNodeId: 'W', period: '2026-02', quantity: 4 }];
const oldOutbound = [{ fromNodeId: 'W', toNodeId: 'C', period: '2026-01', quantity: 3 }, { fromNodeId: 'W', toNodeId: 'C', period: '2026-02', quantity: 4 }];
const newInbound = [{ fromNodeId: 'P', toNodeId: 'E', period: '2026-01', quantity: 3 }, { fromNodeId: 'P', toNodeId: 'E', period: '2026-02', quantity: 4 }];
const newOutbound = [{ fromNodeId: 'E', toNodeId: 'C', period: '2026-01', quantity: 3 }, { fromNodeId: 'E', toNodeId: 'C', period: '2026-02', quantity: 4 }];
const compareSnapshot = { ...snapshot, baseline: { inbound: oldInbound, outbound: oldOutbound }, rows: [
  { scenarioId: 'candidate-2', selectedSites: [{ nodeId: 'E' }], inbound: newInbound, outbound: newOutbound }
] };
const relations = model => model.features.filter(feature => feature.geometry.type === 'LineString');
const comparison = map.projectComparison(compareStudy, compareSnapshot);
assert.equal(comparison.provenance.reference, 'OBSERVED_BASELINE');
assert.equal(comparison.provenance.selectedScenarioId, 'candidate-2');
assert.equal(relations(comparison).length, 2, 'Outbound scope compares both networks without adding inbound');
assert.equal(relations(comparison).find(feature => feature.properties.layer === 'reference-outbound').properties.quantity, 7);
assert.equal(relations(comparison).find(feature => feature.properties.layer === 'candidate-outbound').properties.quantity, 7);
assert.ok(relations(comparison).every(feature => feature.properties.change !== 'UNCHANGED'));
assert.match(comparison.legend, /不是道路路线/);
assert.equal(map.projectComparison(compareStudy, compareSnapshot, { mode: 'CANDIDATE', period: '2026-01' }).features.filter(feature => feature.properties.comparison).length, 1);
assert.equal(map.projectComparison(compareStudy, { ...compareSnapshot, studyHash: 'STALE' }).features.filter(feature => feature.properties.comparison).length, 0);

const fullChain = map.projectComparison(compareStudy, { ...compareSnapshot, schemaVersion: 'stct-supply-chain-v5-snapshot-v1', analysisScope: 'FULL_CHAIN', planningReference: { inbound: newInbound, outbound: oldOutbound } });
assert.equal(fullChain.provenance.reference, 'SAME_CONDITION_PLANNING_REFERENCE');
assert.equal(relations(fullChain).find(feature => feature.properties.layer === 'reference-inbound').properties.toNodeId, 'E', 'Historical inbound must not replace the same-condition reference');
const upstream = map.projectComparison(compareStudy, { ...compareSnapshot, schemaVersion: 'stct-supply-chain-v5-snapshot-v1', analysisScope: 'UPSTREAM_ONLY', baseline: { inbound: [...oldInbound, { fromNodeId: 'X', toNodeId: 'W', period: '2026-01', quantity: 2 }], outbound: oldOutbound }, rows: [{ scenarioId: 'candidate-2', selectedSites: [{ nodeId: 'E' }], inbound: newInbound, outbound: [] }] });
assert.equal(upstream.provenance.reference, 'OBSERVED_KNOWN_INBOUND');
assert.equal(relations(upstream).length, 2, 'Unknown external supply and outbound are outside the upstream comparison');
assert.ok(relations(upstream).every(feature => feature.properties.layer.endsWith('inbound')));

console.log('V8 supply map: current result, source/site/customer, stale and unknown coordinate PASS');
