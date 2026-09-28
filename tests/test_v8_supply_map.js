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
assert.match(result.entities.find(entity => entity.id === 'W').facts.find(row => row[0] === '供应商→仓供货关系')[1], /^7\.000/);
assert.match(result.entities.find(entity => entity.id === 'W').facts.find(row => row[0] === '仓→送货地分配关系')[1], /^7\.000/);

const stale = map.project(study, { ...snapshot, studyHash: 'OLD' }, 'en');
assert.equal(stale.provenance.snapshotHash, null);
assert.equal(stale.provenance.focusScenarioId, null);
assert.equal(stale.features.filter(feature => feature.geometry.type === 'LineString').length, 0, 'Stale snapshot cannot supply relations');

const unconfirmed = map.project({ ...study, coordinateUse: 'UNCONFIRMED' }, snapshot, 'ja');
assert.equal(unconfirmed.features.length, 0, 'Unconfirmed coordinates are listed but not mapped');
assert.equal(unconfirmed.entities.length, study.nodes.length);

console.log('V8 supply map: current result, source/site/customer, stale and unknown coordinate PASS');
