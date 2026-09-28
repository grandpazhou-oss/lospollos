'use strict';
const assert = require('node:assert/strict');
const Contract = require('../network-contract-v18.js');
const Design = require('../supply-chain-design-v19.js');
const Controller = require('../supply-chain-controller-v19.js');
const View = require('../supply-chain-view-v19.js');

const rows = new Map();
const repository = {
  record: (id, payload) => ({ id, payload, contentHash: Contract.hashArtifact(payload) }),
  async read(store, id) { return id === undefined ? [] : rows.get(`${store}:${id}`) || null; },
  async commit({ records, pointer, expectedRevision }) { const old = rows.get(`pointers:${pointer.id}`); assert.equal(old?.revision || 0, expectedRevision); for (const [store, items] of Object.entries(records)) for (const item of items) rows.set(`${store}:${item.id}`, item); const saved = { ...pointer, revision: expectedRevision + 1 }; rows.set(`pointers:${pointer.id}`, saved); return { pointer: saved }; }
};
const study = Design.createStudy({ studyId: 'FORM-SYNC', classification: 'SYNTHETIC', coordinateUse: 'ASSUMED_WGS84_SCREENING', nodes: [{ nodeId: 'SITE-A', role: 'DC', name: 'Alpha Site', coordinate: [120, 30] }, { nodeId: 'SITE-B', role: 'DC', name: 'Beta Site', coordinate: [121, 30] }, { nodeId: 'SITE-C', role: 'DC', name: 'Gamma Site', coordinate: [122, 30] }, { nodeId: 'F', role: 'FACTORY', name: 'Source Factory', coordinate: [119, 30] }, { nodeId: 'C', role: 'CUSTOMER', coordinate: [120.5, 30] }], periodDemand: [{ demandId: 'D', customerNodeId: 'C', currentSiteId: 'SITE-A', period: 'P1', quantity: 5, unit: 'm3' }] });
(async () => {
  const controller = Controller.createController({ repository, fetch: async () => ({ ok: true, json: async () => ({ available: true }) }) });
  const view = View.createView({ download() {} });
  view.setController(controller);
  await view.onChange({ target: { dataset: { supplyFile: 'study' }, files: [{ text: async () => JSON.stringify(study) }] } });
  for (const [site, mode] of [['SITE-A', 'keep'], ['SITE-B', 'adjust'], ['SITE-C', 'adjust']]) view.onInput({ target: { dataset: { supplySite: site }, value: mode } });
  view.onInput({ target: { dataset: { supplyField: 'minSites' }, value: '2' } });
  view.onInput({ target: { dataset: { supplyField: 'maxSites' }, value: '2' } });
  assert.deepEqual(controller.snapshot().scenario.facilityCounts, [2]);
  view.onInput({ target: { dataset: { supplyField: 'maxSites' }, value: '3' } });
  view.onInput({ target: { dataset: { supplyField: 'minSites' }, value: '3' } });
  assert.deepEqual(controller.snapshot().scenario.facilityCounts, [3]);
  assert.deepEqual(controller.snapshot().scenario.requiredSiteIds, ['SITE-A']);
  const matrixCsv = Buffer.from('from,to,distanceKm,quality,source,unit\nAlpha Site,C,10,VERIFIED_ROAD,SYNTHETIC_TEST,km\nBeta Site,C,5,VERIFIED_ROAD,SYNTHETIC_TEST,km\n');
  await view.onChange({ target: { dataset: { supplyFile: 'matrix' }, files: [{ name: 'roads.csv', arrayBuffer: async () => matrixCsv }] } });
  await view.action('matrix-confirm');
  assert.equal(controller.snapshot().study.distanceRows.length, 2);
  assert.equal(controller.snapshot().study.distanceRows[0].fromNodeId, 'SITE-A');
  view.onInput({ target: { dataset: { supplyRate: 'OUTBOUND_TRANSPORT', rateKey: 'amount' }, value: '1.5' } });
  view.onInput({ target: { dataset: { supplyRate: 'OUTBOUND_TRANSPORT', rateKey: 'status' }, value: 'ASSUMED' } });
  assert.equal(controller.snapshot().study.rates.find(row => row.kind === 'OUTBOUND_TRANSPORT').amount, 1.5);
  view.onInput({ target: { dataset: { supplyCapacity: 'SITE-A|P1' }, value: '8' } });
  assert.equal(controller.snapshot().study.nodes.find(row => row.nodeId === 'SITE-A').capacityByPeriod.P1, 8);
  view.onInput({ target: { dataset: { supplyField: 'source-SITE-A' }, value: 'F' } });
  assert.equal(controller.snapshot().scenario.sourcePlan.length, 0);
  assert.equal(controller.snapshot().scenario.sourcePlanDraft.find(row => row.siteNodeId === 'SITE-A').sourceNodeId, 'F');
  view.onInput({ target: { dataset: { supplyField: 'objectiveScope' }, value: 'TWO_END' } });
  assert.equal(controller.snapshot().scenario.sourcePlan.find(row => row.siteNodeId === 'SITE-A').sourceNodeId, 'F');
  const advanced = { ...controller.snapshot().scenario, facilityCounts: [2], requiredSiteIds: ['SITE-B'], forbiddenSiteIds: [], selectedSiteIds: ['SITE-A', 'SITE-B', 'SITE-C'] };
  view.onInput({ target: { dataset: { supplyField: 'scenarioText' }, value: JSON.stringify(advanced) } });
  await view.action('scenario-json-apply');
  assert.deepEqual(controller.snapshot().scenario.facilityCounts, [2]);
  assert.deepEqual(controller.snapshot().scenario.requiredSiteIds, ['SITE-B']);
  const html = view.render(controller.snapshot(), 'zh');
  assert.match(html, /data-supply-field="minSites"[^>]+value="2"/);
  assert.match(html, /data-supply-site="SITE-B" value="keep" checked/);
  console.log(JSON.stringify({ suite: 'SUPPLY_CHAIN_FORM_SYNC_V19', status: 'PASS', twoToThreeDirect: true, requiredSiteApplied: true, advancedToForm: true, namedMatrixImport: true, rateAndCapacityForms: true, sourceNameSelection: true }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
