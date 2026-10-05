#!/usr/bin/env node
'use strict';
// Executes production closures with DOM/camera doubles. This is module evidence, not browser E2E.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const Map = require('../platform-supply-map-v8.js');
const source = fs.readFileSync(path.join(root, 'platform-map-runtime-v19.js'), 'utf8');
const checks = [];
const check = (name, run) => { run(); checks.push(name); };
const plain = value => JSON.parse(JSON.stringify(value));
const seam = `
  root.__coverageTest={
    configure(next,state={}){
      model=next;config={locale:'zh'};owner='SUPPLY';views.clear();
      Object.assign(view(),{presentation:'coverage',selectedEntityId:'',selectedRelationId:'',hoverRelationId:'',analysisIds:[],linkedOpen:false},state);
      coverageCache=null;linkedCache=null;
      const nodes=new Map();host={dataset:{},classList:{remove(){}},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{hidden:false,innerHTML:'',focus(){},setAttribute(){},remove(){}});return nodes.get(selector);},querySelectorAll(){return [];}};
      renderAnalysis=()=>{};list=()=>{};inspector=()=>{};updateSource=()=>{};renderMode=()=>{};syncObjectList=()=>{};
    },coverageActive,candidateCoverage,coverageFeatures,activeFeatures,reconcileCoverageFocus,select,clearFocus,state:()=>view()
  };
`;
assert.match(source, /\}\)\(globalThis\);\s*$/);
const sandbox = { structuredClone, STCTPlatformV19: { supplyMap: Map }, localStorage: { getItem: () => null } };
vm.runInNewContext(source.replace(/\}\)\(globalThis\);\s*$/, seam + '})(globalThis);'), sandbox,
  { filename: 'platform-map-runtime-v19.js (coverage unit seam)' });
const api = sandbox.__coverageTest;
const node = (nodeId, role, coordinate) => ({ nodeId, name: nodeId, role, coordinate, coordinateSystem: 'WGS84' });
const row = (fromNodeId, toNodeId, quantity) => ({ fromNodeId, toNodeId, quantity, period: '2027-01', distanceKm: 10, cost: null });
const study = { studyId: 'SYNTHETIC-RUNTIME-COVERAGE', inputHash: 'I', unit: 't', periods: ['2027-01'], nodes: [
  node('S', 'SUPPLIER', [100, 20]), node('A', 'DC', null), node('B', 'DC', [101, 20]),
  node('C', 'CUSTOMER', [102, 20]), node('D', 'CUSTOMER', [103, 20])
] };
const snapshot = { studyHash: 'I', snapshotHash: 'H', schemaVersion: 'stct-supply-chain-v5-snapshot-v1', analysisScope: 'FULL_CHAIN',
  planningReference: { inbound: [row('S', 'B', 6)], outbound: [row('A', 'C', 2), row('B', 'D', 4)], transfer: [] },
  rows: [{ scenarioId: 'P', selectedSiteIds: ['A', 'B'], inbound: [row('S', 'B', 6)], outbound: [row('A', 'C', 2), row('B', 'D', 4)], transfer: [row('A', 'B', 3)] }],
  decision: { focusScenarioId: 'P' } };
const model = Map.projectComparison(study, snapshot), original = JSON.stringify({ study, snapshot, model });

check('Default coverage shows all drawable current-leg candidate links and excludes reference links', () => {
  api.configure(model);
  assert.equal(api.coverageActive(), true);
  const features = api.activeFeatures();
  const lines = features.filter(f => f.geometry.type === 'LineString');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].properties.fromNodeId, 'B');
  assert.equal(lines[0].properties.toNodeId, 'D');
  assert.ok(lines.every(f => f.properties.comparison === 'candidate'));
  assert.ok(lines.every(f => f.properties.layer === 'candidate-outbound'));
  assert.ok(lines.every(f => f.properties.displayWidth >= .8 && f.properties.displayWidth <= 1.4));
  assert.ok(!lines.some(f => f.properties.fromNodeId === 'A'), 'missing warehouse coordinates must not create a line');
  assert.deepEqual(features.filter(f => f.geometry.type === 'Point').map(f => f.properties.entityId).sort(), ['B', 'C', 'D']);
  assert.equal(api.candidateCoverage().totalQuantity, 6);
});
check('Selecting a warehouse with no coordinate still emphasizes its genuinely assigned mapped receiver', () => {
  api.configure(model, { selectedEntityId: 'A' });
  const customer = api.activeFeatures().find(f => f.geometry.type === 'Point' && f.properties.entityId === 'C');
  assert.equal(api.candidateCoverage().warehouses.find(w => w.id === 'A').quantity, 2);
  assert.equal(customer.properties.context, false);
  assert.equal(api.activeFeatures().some(f => f.geometry.type === 'LineString' && f.properties.fromNodeId === 'A'), false);
  assert.equal(api.activeFeatures().find(f => f.geometry.type === 'Point' && f.properties.entityId === 'D').properties.context, true);
});
check('Selecting a receiver whose warehouse is unmapped preserves its visible focus without fabricating a line', () => {
  api.configure(model, { selectedEntityId: 'C' });
  const customer = api.activeFeatures().find(f => f.geometry.type === 'Point' && f.properties.entityId === 'C');
  assert.equal(customer.properties.focused, true);
  assert.equal(customer.properties.context, false);
  assert.equal(api.activeFeatures().filter(f => f.geometry.type === 'LineString').length, 0);
});
check('Full-chain linked inbound filter uses the filtered inbound ledger and invalidates cached coverage', () => {
  api.configure(model, { linkedOpen: true, linkedKind: 'inbound', linkedScope: 'NETWORK' });
  assert.equal(api.candidateCoverage().kind, 'inbound');
  assert.equal(api.candidateCoverage().totalQuantity, 6);
  assert.deepEqual(plain(api.candidateCoverage().receivers.map(r => r.id)), ['S']);
  api.state().linkedKind = 'outbound';
  assert.equal(api.candidateCoverage().kind, 'outbound');
  assert.deepEqual(plain(api.candidateCoverage().receivers.map(r => r.id)), ['C', 'D']);
  api.state().linkedKind = 'transfer';
  assert.equal(api.candidateCoverage().kind, 'transfer');
  assert.equal(api.candidateCoverage().totalQuantity, 3);
  api.state().linkedKind = 'ALL';
  assert.equal(api.candidateCoverage().kind, 'outbound');
});
check('Shared supplier focus distinguishes one warehouse coverage from all warehouses supplied by that supplier', () => {
  const located = { ...study, nodes: study.nodes.map(n => n.nodeId === 'A' ? { ...n, coordinate: [100.5, 20.5] } : n) };
  const shared = { ...snapshot, rows: [{ ...snapshot.rows[0], inbound: [row('S', 'A', 2), row('S', 'B', 4)] }] };
  const upstream = Map.projectComparison(located, shared, { leg: 'INBOUND' });
  api.configure(upstream, { selectedEntityId: 'A' });
  const points = () => new globalThis.Map(api.activeFeatures().filter(f => f.geometry.type === 'Point').map(f => [f.properties.entityId, f.properties]));
  assert.equal(points().get('S').context, false, 'shared supplier belongs to selected warehouse A');
  assert.equal(points().get('A').context, false);
  assert.equal(points().get('B').context, true, 'shared supplier does not pull another warehouse into A focus');
  assert.equal(points().get('S').coverageMulti, true);
  assert.equal(points().get('S').color, '#64748b');
  assert.deepEqual(api.activeFeatures().filter(f => f.geometry.type === 'LineString').map(f => f.properties.toNodeId), ['A']);
  api.state().selectedEntityId = 'S';
  assert.equal(points().get('S').context, false);
  assert.equal(points().get('A').context, false);
  assert.equal(points().get('B').context, false, 'supplier focus includes all of its receiving warehouses');
  assert.deepEqual(api.activeFeatures().filter(f => f.geometry.type === 'LineString').map(f => f.properties.toNodeId).sort(), ['A', 'B']);
});
check('Focused coverage line width remains capped after quantity styling', () => {
  api.configure(model, { selectedEntityId: 'B' });
  const line = api.activeFeatures().find(f => f.geometry.type === 'LineString' && f.properties.fromNodeId === 'B');
  assert.ok(line.properties.flowWidth > 3, 'fixture must exceed the coverage width limit');
  assert.ok(line.properties.displayWidth > 0 && line.properties.displayWidth <= 3);
  api.state().lineWidthMode = 'uniform';
  const uniform = api.activeFeatures().find(f => f.geometry.type === 'LineString');
  assert.ok(uniform.properties.displayWidth > 0 && uniform.properties.displayWidth <= 3);
});
check('Warehouse focus restricts links to that warehouse, and clearing focus restores all drawable candidate links', () => {
  const located = { ...study, nodes: study.nodes.map(n => n.nodeId === 'A' ? { ...n, coordinate: [100.5, 20.5] } : n) };
  const complete = Map.projectComparison(located, snapshot);
  api.configure(complete);
  assert.equal(api.activeFeatures().filter(f => f.geometry.type === 'LineString').length, 2);
  api.select('A', false, { locate: false });
  const focused = api.activeFeatures().filter(f => f.geometry.type === 'LineString');
  assert.equal(focused.length, 1);
  assert.equal(focused[0].properties.fromNodeId, 'A');
  assert.ok(focused[0].properties.displayWidth <= 3);
  api.clearFocus(false);
  const restored = api.activeFeatures().filter(f => f.geometry.type === 'LineString');
  assert.deepEqual(restored.map(f => f.properties.fromNodeId).sort(), ['A', 'B']);
  assert.ok(restored.every(f => f.properties.comparison === 'candidate'));
  assert.ok(restored.every(f => f.properties.displayWidth >= .8 && f.properties.displayWidth <= 1.4));
  assert.ok(api.activeFeatures().every(f => f.properties.context !== true));
});
check('Reference-only and legacy relations views retain their original comparison features and widths', () => {
  const reference = Map.projectComparison(study, snapshot, { mode: 'REFERENCE' });
  api.configure(reference);
  assert.equal(api.coverageActive(), false);
  assert.ok(api.activeFeatures().some(f => f.geometry.type === 'LineString' && f.properties.comparison === 'reference'));
  assert.ok(api.activeFeatures().every(f => f.geometry.type !== 'LineString' || f.properties.comparison === 'reference'));
  api.configure(model, { presentation: 'relations' });
  assert.equal(api.coverageActive(), false);
  const line = api.activeFeatures().find(f => f.geometry.type === 'LineString' && f.properties.comparison === 'candidate' && f.properties.fromNodeId === 'B');
  assert.equal(line.properties.displayWidth, line.properties.flowWidth);
});
check('Comparison, guide and analytical workflows suspend coverage without discarding their state', () => {
  for (const state of [{ split: true }, { guideOpen: true }, { analysisOpen: true }, { flowOpen: true }, { selectedRelationId: 'relation' }]) {
    api.configure(model, state);
    assert.equal(api.coverageActive(), false);
    for (const [key, value] of Object.entries(state)) assert.equal(api.state()[key], value);
  }
});
check('Switching candidate clears focus on a closed warehouse instead of dimming the whole new coverage', () => {
  const changed = { ...snapshot, rows: [{ ...snapshot.rows[0], scenarioId: 'P2', selectedSiteIds: ['B'], outbound: [row('B', 'C', 2), row('B', 'D', 4)] }], decision: { focusScenarioId: 'P2' } };
  const next = Map.projectComparison(study, changed);
  api.configure(next, { selectedEntityId: 'A', inspectorOpen: true, inspectorDismissed: false });
  api.reconcileCoverageFocus();
  assert.equal(api.state().selectedEntityId, '');
  assert.equal(api.state().inspectorOpen, false);
  assert.ok(api.activeFeatures().every(f => f.properties.context !== true));
  api.configure(next, { selectedEntityId: 'C', inspectorOpen: true });
  api.reconcileCoverageFocus();
  assert.equal(api.state().selectedEntityId, 'C');
  assert.equal(api.state().inspectorOpen, true);
});
check('Valid zero-coverage candidate warehouses remain selectable, while relations-mode historical focus is retained', () => {
  const zero = { ...snapshot, rows: [{ ...snapshot.rows[0], outbound: [row('B', 'D', 4)] }] };
  api.configure(Map.projectComparison(study, zero), { selectedEntityId: 'A', inspectorOpen: true });
  api.reconcileCoverageFocus();
  assert.equal(api.state().selectedEntityId, 'A');
  assert.equal(api.candidateCoverage().warehouses.find(w => w.id === 'A').quantity, 0);
  const closed = { ...zero, rows: [{ ...zero.rows[0], selectedSiteIds: ['B'] }] };
  api.configure(Map.projectComparison(study, closed), { presentation: 'relations', selectedEntityId: 'A', inspectorOpen: true });
  api.reconcileCoverageFocus();
  assert.equal(api.state().selectedEntityId, 'A');
  assert.equal(api.state().inspectorOpen, true);
});
check('Choosing a reference-only warehouse from the object list opens relation comparison; covered objects keep coverage', () => {
  const located = { ...study, nodes: study.nodes.map(n => n.nodeId === 'A' ? { ...n, coordinate: [100.5, 20.5] } : n) };
  const changed = { ...snapshot, rows: [{ ...snapshot.rows[0], scenarioId: 'P2', selectedSiteIds: ['B'], outbound: [row('B', 'C', 2), row('B', 'D', 4)] }], decision: { focusScenarioId: 'P2' } };
  const next = Map.projectComparison(located, changed);
  api.configure(next);
  api.select('A', false, { locate: false });
  assert.equal(api.state().presentation, 'relations');
  assert.equal(api.state().selectedEntityId, 'A');
  assert.equal(api.state().inspectorOpen, true);
  assert.ok(api.activeFeatures().some(f => f.geometry.type === 'LineString' && f.properties.comparison === 'reference' && f.properties.fromNodeId === 'A'));
  assert.equal(next.provenance.selectedScenarioId, 'P2');
  for (const id of ['B', 'C']) {
    api.configure(next);
    api.select(id, false, { locate: false });
    assert.equal(api.state().presentation, 'coverage');
    assert.equal(api.coverageActive(), true);
    assert.equal(api.state().selectedEntityId, id);
    assert.equal(api.state().inspectorOpen, true);
  }
});
check('Coverage display and state reconciliation never mutate the original model or result inputs', () => {
  assert.equal(JSON.stringify({ study, snapshot, model }), original);
});
console.log(JSON.stringify({ status: 'PASS', checks: checks.length, evidence: 'Node VM production-closure regression; not browser or native-solver acceptance', cases: checks }, null, 2));
