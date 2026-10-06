'use strict';
// Real production view/controller/domain methods; synthetic memory repository only.
// Await the actual public file-change handler: no browser, native IDB or solver claim.
const assert = require('node:assert/strict');
const test = require('node:test');
const Controller = require('../supply-chain-controller-v19.js');
const View = require('../supply-chain-view-v19.js');
const Design = require('../supply-chain-design-v19.js');
global.STCTV18 = {networkContract: require('../network-contract-v18.js')};
const {createRepository} = require('./helpers_memrepo.js');

const input = (id = 'SYNTHETIC-DRAFT-IMPORT') => ({
  studyId: id, name: 'Invented draft import fixture', classification: 'SYNTHETIC',
  coordinateUse: 'ASSUMED_WGS84_SCREENING',
  nodes: [
    {nodeId: 'A', name: 'Synthetic Alpha', role: 'DC', coordinate: [120, 30], capacityByPeriod: {P: 100}},
    {nodeId: 'B', name: 'Synthetic Beta', role: 'DC', coordinate: [121, 30], capacityByPeriod: {P: 100}},
    {nodeId: 'C', role: 'CUSTOMER', coordinate: [120.2, 30]}
  ],
  periodDemand: [{demandId: 'D', customerNodeId: 'C', currentSiteId: 'A', period: 'P', quantity: 5, unit: 'm3'}],
  distanceRows: ['A', 'B'].map((fromNodeId, i) => ({fromNodeId, toNodeId: 'C', distanceKm: 10-i*4,
    quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST', unit: 'km'}))
});
const scenario = {scenarioId: 'Synthetic retained draft', type: 'NETWORK_CANDIDATE', objective: 'VOLUME_KM',
  objectiveScope: 'OUTBOUND_ONLY', analysisScope: 'OUTBOUND_ONLY', distanceBasis: 'VERIFIED_ROAD',
  facilityCounts: [1, 2], selectedSiteIds: ['A', 'B'], requiredSiteIds: [], forbiddenSiteIds: [],
  assignmentLocks: {D: 'B'}, allowedService: {D: ['A', 'B']}, sourcePlan: [], sourcePlanDraft: [],
  capacityByPeriod: {}, maxDistanceKm: 100, maxServiceSeconds: 3600, oneTimeConversionCost: 12,
  timeLimitSeconds: 30, runBudgetSeconds: 30, planCount: 3, objectiveMode: 'DISTANCE', costMode: 'DISTANCE_ONLY'};
const controller = repository => Controller.createController({repository,
  fetch: async () => { throw Error('This offline view test must not use the network'); }});
function draft() {
  const source = controller(createRepository());
  const staleResult = {snapshotHash: 'sha256:' + 'a'.repeat(64), studyHash: 'sha256:' + 'b'.repeat(64),
    reason: 'STUDY_INPUT_CHANGED'};
  source.loadStudy(input(), {profileId: 'SYNTHETIC-PROFILE', blocks: []}, staleResult);
  source.configureScenario(scenario);
  return JSON.parse(source.exportDraftPackage());
}
function attach(owner) {
  const view = View.createView({download() {}});
  view.setController(owner);
  return view;
}
const event = value => ({target: {dataset: {supplyFile: 'study'},
  files: [{text: async () => JSON.stringify(value)}]}});

async function existing() {
  const repository = createRepository(), owner = controller(repository);
  owner.loadStudy(input('SYNTHETIC-EXISTING'));
  owner.configureScenario({...scenario, scenarioId: 'Previously saved scenario'});
  const receipt = await owner.save();
  return {repository, owner, receipt, view: attach(owner)};
}

test('awaited public draft import preserves all conditions, stale provenance and profile', async () => {
  const packed = draft(), {owner, view, repository, receipt} = await existing();
  const original = owner.snapshot();
  let resolve;
  const pendingText = new Promise(r => { resolve = r; });
  const loading = view.onChange({target: {dataset: {supplyFile: 'study'}, files: [{text: () => pendingText}]}});
  assert.deepEqual(owner.snapshot(), original, 'Pending file read must not alter the prior study');
  resolve(JSON.stringify(packed));
  await loading; // The real handler has completed, not merely the study-hash observation.
  const imported = owner.snapshot();
  assert.deepEqual(imported.scenario, packed.scenario);
  assert.deepEqual(imported.staleResult, packed.staleResult);
  assert.deepEqual(imported.profile, packed.profile);
  assert.equal(imported.study.inputHash, packed.study.inputHash);
  assert.equal(imported.snapshot, null);
  assert.equal(imported.savedPointer, null, 'Import must not adopt the old durable receipt');
  assert.deepEqual(await repository.read('pointers', receipt.pointer.id), receipt.pointer);
  const html = view.render(imported, 'en');
  assert.match(html, /data-supply-field="planName"[^>]*value="Synthetic retained draft"/);
  assert.match(html, /data-supply-field="minSites"[^>]*value="1"/);
  assert.match(html, /data-supply-field="maxSites"[^>]*value="2"/);
});

for (const [label, mutate] of [
  ['study payload', value => { value.study.name = 'Changed without rehashing'; }],
  ['scenario conditions', value => { value.scenario.facilityCounts = [1]; }],
  ['stale provenance', value => { value.staleResult.reason = 'Forged provenance'; }],
  ['package hash', value => { value.packageHash = 'sha256:' + '0'.repeat(64); }]
]) {
  test(`public draft import rejects altered ${label} without changing study or saved pointer`, async () => {
    const packed = draft(), {owner, view, repository, receipt} = await existing();
    const original = owner.snapshot(), records = await repository.read('supplyStudies');
    mutate(packed);
    await assert.rejects(view.onChange(event(packed)), {code: 'SUPPLY_PACKAGE_INVALID'});
    assert.deepEqual(owner.snapshot(), original);
    assert.deepEqual(await repository.read('pointers', receipt.pointer.id), receipt.pointer);
    assert.deepEqual(await repository.read('supplyStudies'), records);
  });
}

for (const wrapped of [false, true]) {
  test(`intentional ${wrapped ? 'wrapped' : 'direct'} raw study JSON import remains supported`, async () => {
    const {owner, view} = await existing(), study = Design.createStudy(input('SYNTHETIC-RAW'));
    await view.onChange(event(wrapped ? {study, profile: {profileId: 'RAW-PROFILE', blocks: []}} : study));
    assert.equal(owner.snapshot().study.inputHash, study.inputHash);
    assert.equal(owner.snapshot().scenario, null);
    assert.equal(owner.snapshot().savedPointer, null);
  });
}

test('public complete-package import still uses verified snapshot import', async () => {
  const source = controller(createRepository());
  source.loadStudy(input('SYNTHETIC-COMPLETE'));
  source.calculateBaseline('VERIFIED_ROAD');
  source.configureScenario({...scenario, selectedSiteIds: ['B'], facilityCounts: [1]});
  source.evaluateConfigured([{demandId: 'D', siteId: 'B'}]);
  source.compare();
  const packed = JSON.parse(source.exportPackage()), {owner, view} = await existing();
  await view.onChange(event(packed));
  assert.deepEqual(owner.snapshot().snapshot, packed.snapshot);
  assert.equal(owner.snapshot().study.inputHash, packed.study.inputHash);
  assert.equal(owner.snapshot().savedPointer, null);
});
