#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const Map = require('../platform-supply-map-v8.js');
const checks = [];
const check = (name, run) => { run(); checks.push(name); };
const node = (nodeId, role, coordinate, coordinateSystem = 'WGS84') => ({ nodeId, name: nodeId, role, coordinateSystem, coordinate });
const row = (fromNodeId, toNodeId, quantity, period = '2027-01') => ({ fromNodeId, toNodeId, quantity, period, distanceKm: null, cost: null });
const study = { studyId: 'SYNTHETIC-COVERAGE', inputHash: 'INPUT', periods: ['2027-01', '2027-02'], unit: 't', nodes: [
  node('S-A', 'SUPPLIER', [108, 28]), node('S-B', 'SUPPLIER', null),
  node('W-A', 'DC', null), node('W-B', 'DC', [110, 30]), node('W-Y', 'DC', null), node('W-Z', 'DC', [111, 30]),
  node('P1', 'CUSTOMER', [112, 30]), node('P2', 'CUSTOMER', [112, 30]),
  node('MISSING', 'CUSTOMER', null), node('UNCONFIRMED', 'CUSTOMER', [115, 30], 'UNKNOWN')
] };
const outbound = [row('W-A', 'P1', .001), row('W-A', 'P1', .002, '2027-02'), row('W-B', 'P1', 4),
  row('W-B', 'P2', 2), row('W-A', 'MISSING', 3), row('W-B', 'UNCONFIRMED', 1)];
const inbound = [row('S-A', 'W-A', 2), row('S-A', 'W-B', 5), row('S-B', 'W-B', 3)];
const transfer = [row('W-A', 'W-B', 6)];
const snapshot = { schemaVersion: 'stct-supply-chain-v5-snapshot-v1', studyHash: 'INPUT', snapshotHash: 'SNAP', analysisScope: 'FULL_CHAIN',
  planningReference: { inbound: [row('S-A', 'W-Z', 10)], outbound: [row('W-Z', 'P1', 10)], transfer: [] },
  rows: [{ scenarioId: 'PLAN', selectedSiteIds: ['W-A', 'W-B', 'W-Y', 'W-Z'], inbound, outbound, transfer }], decision: { focusScenarioId: 'PLAN' } };
const original = JSON.stringify({ study, snapshot });
const model = Map.projectComparison(study, snapshot), before = JSON.stringify(model);
const result = Map.candidateCoverage(model);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

check('Full-chain defaults to actual candidate outbound membership, excluding reference-only relations', () => {
  assert.equal(result.kind, 'outbound');
  assert.equal(result.totalQuantity, 10.003);
  assert.equal(result.receiverCount, 4);
  assert.deepEqual(result.relationIds, model.relations.filter(r => r.kind === 'outbound' && r.after > 0).map(r => r.relationId).sort());
  assert.ok(!result.relationIds.some(id => id.includes('W-Z')));
});
check('Sub-display-unit quantities remain unrounded', () => {
  assert.equal(result.warehouses.find(w => w.id === 'W-A').quantity, 3.003);
  assert.equal(result.receivers.find(r => r.id === 'P1').quantity, 4.003);
  const february = Map.candidateCoverage(Map.projectComparison(study, snapshot, { period: '2027-02' }));
  assert.equal(february.totalQuantity, .002);
  assert.equal(february.receiverCount, 1);
});
check('Same-coordinate customers retain distinct identities and volume', () => {
  assert.ok(result.receivers.some(r => r.id === 'P1'));
  assert.ok(result.receivers.some(r => r.id === 'P2'));
  assert.equal(result.receivers.find(r => r.id === 'P2').quantity, 2);
  assert.equal(result.mappedReceiverCount, 2);
});
check('Missing warehouse coordinates do not hide mapped receiving locations', () => {
  const warehouse = result.warehouses.find(w => w.id === 'W-A');
  assert.equal(warehouse.receiverCount, 2);
  assert.equal(warehouse.mappedReceiverCount, 1);
  assert.equal(warehouse.missingReceiverCount, 1);
  assert.equal(result.receivers.find(r => r.id === 'P1').mapped, true);
});
check('Missing or unconfirmed receiver coordinates remain in totals and are counted separately', () => {
  assert.equal(result.missingReceiverCount, 2);
  for (const id of ['MISSING', 'UNCONFIRMED']) assert.equal(result.receivers.find(r => r.id === id).mapped, false);
  assert.equal(result.receivers.find(r => r.id === 'MISSING').quantity, 3);
});
check('Shared coverage is neutral and names every warehouse without inventing a primary source', () => {
  const shared = result.receivers.find(r => r.id === 'P1');
  assert.deepEqual(shared.warehouseIds, ['W-A', 'W-B']);
  assert.equal(shared.multiple, true);
  assert.equal(shared.color, '#64748b');
  assert.equal(result.multiWarehouseCount, 1);
  const single = result.receivers.find(r => r.id === 'P2');
  assert.equal(single.multiple, false);
  assert.equal(single.color, model.entities.find(e => e.id === 'W-B').warehouseColor);
});
check('Selected warehouses with zero coverage are retained as zero rows', () => {
  const empty = result.warehouses.find(w => w.id === 'W-Z');
  assert.equal(empty.quantity, 0);
  assert.equal(empty.receiverCount, 0);
  assert.deepEqual(empty.relationIds, []);
  assert.equal(result.warehouses.find(w => w.id === 'W-Y').quantity, 0);
  assert.equal(model.entities.find(e => e.id === 'W-Y').candidateSelected, true);
  assert.ok(!model.features.some(f => f.geometry.type === 'Point' && f.properties.entityId === 'W-Y'));
  const noCoordinate = Map.candidateCoverage({ ...model, entities: [...model.entities, { id: 'W-N', label: 'Selected without coordinates', kind: 'facility', candidateSelected: true, coordinate: null }] });
  assert.equal(noCoordinate.warehouses.find(w => w.id === 'W-N').quantity, 0);
});
check('Upstream scope and explicit inbound selection use receiving warehouse and supplier memberships', () => {
  const upstream = Map.candidateCoverage({ ...model, provenance: { ...model.provenance, analysisScope: 'UPSTREAM_ONLY' } });
  assert.equal(upstream.kind, 'inbound');
  assert.equal(upstream.totalQuantity, 10);
  assert.equal(upstream.receiverCount, 2);
  assert.equal(upstream.mappedReceiverCount, 1);
  assert.equal(upstream.multiWarehouseCount, 1);
  assert.equal(upstream.warehouses.find(w => w.id === 'W-A').quantity, 2);
  assert.equal(upstream.warehouses.find(w => w.id === 'W-B').quantity, 8);
  assert.deepEqual(upstream.receivers.find(r => r.id === 'S-A').warehouseIds, ['W-A', 'W-B']);
  assert.deepEqual(Map.candidateCoverage(model, { kind: 'inbound' }), upstream);
  assert.equal(Map.candidateCoverage({ ...model, provenance: { leg: 'INBOUND' } }).kind, 'inbound');
});
check('Transfer selection is independently grouped and explicit selection overrides default scope', () => {
  const moved = Map.candidateCoverage(model, { kind: 'transfer' });
  assert.equal(moved.totalQuantity, 6);
  assert.deepEqual(moved.receivers[0].warehouseIds, ['W-A']);
  assert.equal(moved.receivers[0].id, 'W-B');
  assert.equal(Map.candidateCoverage({ ...model, provenance: { analysisScope: 'UPSTREAM_ONLY' } }, { kind: 'outbound' }).kind, 'outbound');
});
check('Current period and relationship filters control coverage rather than whole-snapshot amounts', () => {
  const filtered = Map.candidateCoverage(Map.projectComparison(study, snapshot, { nodeId: 'P2', period: '2027-01' }));
  assert.equal(filtered.totalQuantity, 2);
  assert.deepEqual(filtered.receivers.map(r => r.id), ['P2']);
  assert.equal(Map.candidateCoverage(Map.projectComparison(study, snapshot, { change: 'REMOVED' })).totalQuantity, 0);
});
check('Invalid, absent and nonpositive quantities do not become fabricated candidate coverage', () => {
  const invalid = [null, undefined, NaN, Infinity, -1, 0, '7'].map((after, index) => ({ relationId: `INVALID-${index}`, kind: 'outbound', fromNodeId: 'W-B', toNodeId: 'P2', after }));
  assert.deepEqual(Map.candidateCoverage({ ...model, relations: [...model.relations, ...invalid] }), result);
});
check('Stable output survives input order changes and duplicate projected relation IDs', () => {
  const reversed = { ...model, entities: [...model.entities].reverse(), relations: [...model.relations].reverse(), features: [...model.features].reverse(), warehouseLegend: [...model.warehouseLegend].reverse() };
  assert.deepEqual(Map.candidateCoverage(reversed), result);
  assert.deepEqual(Map.candidateCoverage({ ...model, relations: [...model.relations, ...model.relations] }), result);
});
check('Entity or legend colors work independently of line rendering, with no geographic coverage fabrication', () => {
  const noLines = { ...model, features: model.features.filter(f => f.geometry.type === 'Point') };
  assert.deepEqual(Map.candidateCoverage(noLines), result);
  const legendOnly = { ...model, entities: model.entities.map(e => ({ ...e, warehouseColor: undefined })), warehouseLegend: [{ id: 'W-A', label: 'A', color: '#abc123' }] };
  assert.equal(Map.candidateCoverage(legendOnly).warehouses.find(w => w.id === 'W-A').color, '#abc123');
  assert.ok(!Object.hasOwn(result, 'polygons'));
});
check('Frozen model and original study/snapshot remain byte-for-byte unchanged', () => {
  assert.deepEqual(Map.candidateCoverage(freeze(model)), result);
  assert.equal(JSON.stringify(model), before);
  assert.equal(JSON.stringify({ study, snapshot }), original);
  assert.deepEqual(Map.candidateCoverage({}), { kind: 'outbound', warehouses: [], receivers: [], totalQuantity: 0, receiverCount: 0, mappedReceiverCount: 0, missingReceiverCount: 0, multiWarehouseCount: 0, relationIds: [], warehouseIds: [] });
});
console.log(JSON.stringify({ status: 'PASS', checks: checks.length, scope: 'Synthetic pure candidate membership projection, no native solver or browser claim', cases: checks }, null, 2));
