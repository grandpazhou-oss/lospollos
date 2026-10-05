'use strict';
const assert = require('node:assert/strict');
const Controller = require('../supply-chain-controller-v19.js');
const Design = require('../supply-chain-design-v19.js');
const View = require('../supply-chain-view-v19.js');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function repository() {
  const records = new Map(); let gate = null, beforeRead = null;
  return {
    record: (id, payload) => ({ id, payload: structuredClone(payload), contentHash: Design.hash(payload) }),
    async read(store, id) { if (beforeRead && store === 'pointers' && id) { const wait = beforeRead; beforeRead = null; wait.entered.resolve(); await wait.release.promise; } return id === undefined ? [] : structuredClone(records.get(`${store}:${id}`) || null); },
    async commit({ records: rows, pointer, expectedRevision }) {
      const key = `pointers:${pointer.id}`, old = records.get(key);
      if ((old?.revision || 0) !== expectedRevision) throw Object.assign(new Error('REVISION_CONFLICT'), { code: 'REVISION_CONFLICT' });
      for (const [store, entries] of Object.entries(rows)) for (const row of entries) records.set(`${store}:${row.id}`, structuredClone(row));
      const saved = { ...pointer, revision: expectedRevision + 1 }; records.set(key, structuredClone(saved));
      if (gate) { const wait = gate; gate = null; wait.entered.resolve(); await wait.release.promise; }
      return { pointer: saved };
    },
    delayReceipt() { return gate = { entered: deferred(), release: deferred() }; },
    delayRead() { return beforeRead = { entered: deferred(), release: deferred() }; }
  };
}
function study(studyId = 'SAVE-SESSION') {
  return { studyId, classification: 'SYNTHETIC_TEST', nodes: [{ nodeId: 'S', role: 'FACTORY', coordinate: [120, 30] }, { nodeId: 'W', role: 'DC', coordinate: [120.1, 30] }, { nodeId: 'C', role: 'CUSTOMER', coordinate: [120.2, 30] }], periodDemand: [{ demandId: 'D', customerNodeId: 'C', currentSiteId: 'W', quantity: 5, period: 'P1', unit: 'm3' }], observedInbound: [{ flowId: 'I', fromNodeId: 'S', toNodeId: 'W', quantity: 5, period: 'P1', unit: 'm3' }] };
}
(async () => {
  const repo = repository(), c = Controller.createController({ repository: repo }); c.loadStudy(study()); await c.save();
  for (const change of [() => c.configureScenario({ scenarioId: 'New conditions' }), () => c.updateStudy({ name: 'Unsaved newer inputs' })]) {
    const wait = repo.delayReceipt(), saving = c.save(); await wait.entered.promise; change(); const live = c.snapshot(); wait.release.resolve(); const saved = await saving;
    assert.equal(c.snapshot().savedPointer.revision, saved.pointer.revision); assert.deepEqual(c.snapshot().study, live.study); assert.deepEqual(c.snapshot().scenario, live.scenario);
    await c.save(); assert.deepEqual((await repo.read('pointers', 'SUPPLY:SAVE-SESSION')).scenario, c.snapshot().scenario);
  }
  const other = Controller.createController({ repository: repo }); await other.reopen('SUPPLY:SAVE-SESSION'); other.updateStudy({ name: 'External newer version' }); await other.save();
  c.updateStudy({ name: 'Stale tab input' }); await assert.rejects(c.save(), { code: 'REVISION_CONFLICT' }); assert.equal((await repo.read('pointers', 'SUPPLY:SAVE-SESSION')).name, 'External newer version');
  await c.reopen('SUPPLY:SAVE-SESSION'); const late = repo.delayReceipt(), pending = c.save(); await late.entered.promise; c.loadStudy(study()); late.release.resolve(); await pending; assert.equal(c.snapshot().savedPointer, null, 'A new load of the same ID is a separate session');
  await c.reopen('SUPPLY:SAVE-SESSION'); const read = repo.delayRead(), obsolete = c.save(); await read.entered.promise; c.updateStudy({ name: 'Changed before commit' }); read.release.resolve(); await assert.rejects(obsolete, { code: 'SUPPLY_SAVE_OBSOLETE' });

  let healthCalls = 0; const v = View.createView({ download() {} }), control = Controller.createController({ repository: repository(), fetch: async () => { healthCalls++; throw new Error('Synthetic unavailable health'); } }); v.setController(control);
  await v.onChange({ target: { dataset: { supplyFile: 'study' }, files: [{ text: async () => JSON.stringify(study('PREFLIGHT')) }] } });
  const field = (key, value) => v.onInput({ target: { dataset: { supplyField: key }, ...(typeof value === 'boolean' ? { checked: value } : { value }) } });
  let html = v.render(control.snapshot(), 'zh'); assert.match(html, /还有 1 项需要确认/); assert.match(html, /data-supply-action="condition-focus"/);
  await v.action('analyze'); assert.equal(healthCalls, 0); assert.doesNotMatch(v.render(control.snapshot(), 'zh'), /sc-message is-error/);
  field('geoConfirmed', true); html = v.render(control.snapshot(), 'zh'); assert.match(html, /条件已就绪/);
  field('analysisScope', 'FULL_CHAIN'); assert.match(v.render(control.snapshot(), 'zh'), /同单位同质物量/); field('homogeneousDemandConfirmed', true);
  assert.match(v.render(control.snapshot(), 'zh'), /请确认勾选的供货关系/); field('allowAllSupplierSiteEdgesConfirmed', true);
  assert.match(v.render(control.snapshot(), 'zh'), /条件已就绪/); assert.equal(control.snapshot().scenario.sourcePlan.length, 0, 'Free mode does not need a source-plan answer');
  const demands = control.snapshot().study.periodDemand; control.updateStudy({ periodDemand: demands.map(row => ({ ...row, quantity: 0.0000001 })) }); assert.match(v.render(control.snapshot(), 'zh'), /安全计算范围/); control.updateStudy({ periodDemand: demands }); assert.match(v.render(control.snapshot(), 'zh'), /条件已就绪/, 'Input changes invalidate cached preparation');
  const unchanged = control.snapshot(); v.render(control.snapshot(), 'en'); v.render(control.snapshot(), 'ja'); assert.deepEqual(control.snapshot(), unchanged, 'Read-only readiness must not configure or mutate the study');
  field('distanceBasis', 'VERIFIED_ROAD'); assert.match(v.render(control.snapshot(), 'zh'), /供货路径缺少/); await v.action('analyze'); assert.equal(healthCalls, 0);
  field('distanceBasis', 'GEOGRAPHIC_SCREENING'); field('objective', 'COST'); assert.match(v.render(control.snapshot(), 'zh'), /费用尚不完整|费用/); field('costMode', 'ACTUAL'); assert.match(v.render(control.snapshot(), 'zh'), /费用补充中声明/);
  v.setError({ code: 'REVISION_CONFLICT' }); assert.match(v.render(control.snapshot(), 'zh'), /sc-recovery-actions/); assert.match(v.render(control.snapshot(), 'zh'), /data-supply-action="save-as-branch"/);
  const originalId = control.snapshot().study.studyId; await v.action('save-as-branch'); assert.notEqual(control.snapshot().study.studyId, originalId); assert.equal(control.snapshot().scenario.analysisScope, 'FULL_CHAIN');
  const autoRepo = repository(), autoControl = Controller.createController({ repository: autoRepo }), autoView = View.createView({ download() {} }); autoView.setController(autoControl);
  await autoView.onChange({ target: { dataset: { supplyFile: 'study' }, files: [{ text: async () => JSON.stringify(study('AUTO-OBSOLETE')) }] } }); await autoView.action('draft-save');
  const autoWait = autoRepo.delayRead(); autoView.onInput({ target: { dataset: { supplyField: 'planName' }, value: 'First edit' } }); await autoWait.entered.promise; autoView.onInput({ target: { dataset: { supplyField: 'planName' }, value: 'Newer edit' } }); autoWait.release.resolve(); await pause(650);
  assert.equal((await autoRepo.read('pointers', 'SUPPLY:AUTO-OBSOLETE')).scenario.scenarioId, 'Newer edit'); assert.doesNotMatch(autoView.render(autoControl.snapshot(), 'zh'), /sc-message is-error/, 'Superseded uncommitted auto-save is cancelled, not a business failure');
  await pause(550);
  console.log(JSON.stringify({ suite: 'SUPPLY_ANALYSIS_PREFLIGHT', status: 'PASS', durableReceiptCases: 2, externalConflictProtected: true, sameIdLoadProtected: true, obsoleteBeforeCommitProtected: true, requestContractPreflight: ['OUTBOUND_ONLY', 'FULL_CHAIN'], renderingReadOnly: true, zhEnJa: true, branchRecovery: true, syntheticRepositoryFaults: true }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
