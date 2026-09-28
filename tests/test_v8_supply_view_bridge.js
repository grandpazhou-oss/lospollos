'use strict';
const assert = require('node:assert/strict');
const XLSX = require('../vendor/xlsx/xlsx.full.min.js');
const Contract = require('../network-contract-v18.js');
const Design = require('../supply-chain-design-v19.js');
const Controller = require('../supply-chain-controller-v19.js');
const View = require('../supply-chain-view-v19.js');

const records = new Map();
const repository = {
  record: (id, payload) => ({ id, payload, contentHash: Contract.hashArtifact(payload) }),
  async read(store, id) { return id === undefined ? [...records.values()].filter(row => row.store === store).map(row => row.value) : records.get(`${store}:${id}`)?.value || null; },
  async commit({ records: changed, pointer, expectedRevision }) {
    const old = records.get(`pointers:${pointer.id}`)?.value;
    assert.equal(old?.revision || 0, expectedRevision);
    for (const [store, rows] of Object.entries(changed)) for (const row of rows) records.set(`${store}:${row.id}`, { store, value: row });
    const saved = { ...pointer, revision: expectedRevision + 1 };
    records.set(`pointers:${pointer.id}`, { store: 'pointers', value: saved });
    return { pointer: saved };
  }
};

function study(id, sites, customer, quantity) {
  return Design.createStudy({
    studyId: id, name: `${id} study`, classification: 'SYNTHETIC', coordinateUse: 'ASSUMED_WGS84_SCREENING',
    nodes: [...sites.map((nodeId, index) => ({ nodeId, role: 'DC', name: `${id} ${nodeId}`, coordinate: [120 + index, 30] })), { nodeId: customer, role: 'CUSTOMER', name: `${id} customer`, coordinate: [120.5, 30] }],
    periodDemand: [{ demandId: `${id}-D`, customerNodeId: customer, currentSiteId: sites[0], period: '2027-03', quantity, unit: 'm3' }]
  });
}

function workbook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['code', 'name', 'role', 'coordinate'], ['C1', 'C site', 'DC', '121,31']]), 'Nodes');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['demandId', 'customerName', 'currentSiteId', 'coordinate', '2027-03'], ['C-D', 'C customer', 'C1', '121.1,31', 6]]), 'Demand');
  return XLSX.write(book, { bookType: 'xlsx', type: 'buffer' });
}

(async () => {
  const controller = Controller.createController({ repository });
  const view = View.createView({ download() {} });
  view.setController(controller);
  const a = study('DEMO-A', ['A1', 'A2', 'A3'], 'A-C', 10);
  const b = study('UC-B', ['B1', 'B2'], 'B-C', 25);
  controller.loadStudy(b);
  controller.configureScenario({ scenarioId: 'B plan', type: 'NETWORK_CANDIDATE', objective: 'VOLUME_KM', analysisScope: 'OUTBOUND_ONLY', distanceBasis: 'GEOGRAPHIC_SCREENING', facilityCounts: [1, 2], selectedSiteIds: ['B1', 'B2'], requiredSiteIds: [], forbiddenSiteIds: [] });
  const pointer = (await controller.save()).pointer;
  controller.loadStudy(a);
  view.hydrateFromController();
  view.onInput({ target: { dataset: { supplyField: 'planName' }, value: 'A-only plan' } });
  assert.match(view.render(controller.snapshot()), /A-only plan/);

  await controller.reopen(pointer.id);
  view.hydrateFromController();
  const bHtml = view.render(controller.snapshot());
  assert.match(bHtml, /UC-B B1/);
  assert.match(bHtml, /B plan/);
  assert.match(bHtml, /data-supply-field="minSites"[^>]*value="1"/);
  assert.doesNotMatch(bHtml, /A-only plan|DEMO-A A1/);
  assert.equal(controller.snapshot().study.inputHash, b.inputHash);
  await assert.rejects(view.beginWorkbook({ name: 'invalid.xlsx', arrayBuffer: async () => Buffer.from('invalid') }));
  assert.equal(controller.snapshot().study.inputHash, b.inputHash, 'failed upload must keep the selected study');
  assert.match(view.render(controller.snapshot()), /UC-B B1/);

  const bytes = workbook();
  let release;
  const slow = view.beginWorkbook({ name: 'late-A.xlsx', arrayBuffer: () => new Promise(resolve => { release = resolve; }) });
  await Promise.resolve();
  view.hydrateFromController();
  release(bytes);
  await slow;
  assert.equal(controller.snapshot().study.inputHash, b.inputHash, 'late upload must not replace selected study');

  await view.beginWorkbook({ name: 'candidate-C.xlsx', arrayBuffer: async () => bytes });
  const imported = controller.snapshot();
  const cHtml = view.render(imported);
  assert.equal(imported.status, 'WORKBOOK_READY');
  assert.equal(imported.study, null);
  assert.equal(imported.workbook.fileName, 'candidate-C.xlsx');
  assert.match(cHtml, /data-supply-field="studyName"[^>]*value="candidate-C"/);
  assert.match(cHtml, /data-supply-action="profile-confirm"/);
  assert.doesNotMatch(cHtml, /A-only plan/);
  console.log(JSON.stringify({ suite: 'V8_SUPPLY_VIEW_BRIDGE', status: 'PASS', selectedStudyHash: b.inputHash, lateUploadIgnored: true, workbookMappingReady: true }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
