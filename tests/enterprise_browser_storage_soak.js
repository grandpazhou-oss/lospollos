/* Native IndexedDB COMPONENT soak. This is deliberately not a public-UI test. */
(() => {
  'use strict';
  const ns = window.STCTPlatformV19;
  const check = (ok, detail) => { if (!ok) throw Error(detail); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const stages = ['BEFORE_RECORDS', 'AFTER_RECORDS', 'BEFORE_POINTER', 'AFTER_POINTER', 'AFTER_SELECTION'];
  const input = {studyId: 'BROWSER-SOAK-COMPONENT', name: 'Synthetic initial',
    classification: 'SYNTHETIC_TEST', nodes: [{nodeId: 'A', role: 'DC'}, {nodeId: 'C', role: 'CUSTOMER'}],
    periodDemand: [{demandId: 'D', customerNodeId: 'C', currentSiteId: 'A', period: 'P', quantity: 5, unit: 'm3'}]};
  let repos = [], a, b, failing, repo, fault = null, initial, completed = 0, raceGate = null;
  const controller = value => ns.supplyChainController.createController({repository: value,
    fetch: async () => { throw Error('Component must not send any native/network request'); }});
  async function counts() {
    const db = await repo.open();
    return new Promise((resolve, reject) => {
      const names = ['supplyStudies', 'supplySnapshots', 'pointers', 'audit'];
      const tx = db.transaction(names, 'readonly'), result = {};
      for (const name of names) {
        const request = tx.objectStore(name).count();
        request.onsuccess = () => { result[name] = request.result; };
      }
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(Error('Component native count failed'));
    });
  }
  async function reject(promise, code) {
    let caught;
    try { await promise; } catch (error) { caught = error; }
    check(caught?.code === code, `Expected ${code}, got ${caught?.code || caught || 'FALSE_SUCCESS'}`);
  }
  async function verifyHistory() {
    const records = await repo.read('supplyStudies');
    const audits = (await repo.read('audit')).sort((x, y) => x.revision - y.revision);
    check(records.length === completed + 1, 'Unexpected immutable history count');
    check(audits.length === completed + 1, 'Unexpected audit count');
    check(audits.every((row, i) => row.revision === i + 1), 'Non-contiguous audit revisions');
    for (const row of records) {
      check(row.contentHash === ns.supplyChainDesign.hash(row.payload), 'Historical payload hash mismatch');
      check(row.id === row.payload.inputHash, 'Historical input hash identity mismatch');
      check(row.payload.studyId === input.studyId, 'History contains unexpected study');
    }
    check(same(await repo.read('supplyStudies', initial.id), initial), 'Original immutable version changed');
    const versions = await a.listVersions('SUPPLY:' + input.studyId);
    check(versions.length === records.length, 'Public component history omitted a version');
    return {historyRecords: records.length, auditRecords: audits.length};
  }
  window.enterpriseStorageSoak = {
    async bounded(method, argument, timeoutMs = 15000) {
      let timer;
      try {
        return await Promise.race([
          Promise.resolve().then(() => window.enterpriseStorageSoak[method](argument)),
          new Promise((_, reject) => { timer = setTimeout(() =>
            reject(Error('COMPONENT_OPERATION_TIMEOUT:' + method)), timeoutMs); })
        ]);
      } finally { clearTimeout(timer); }
    },
    async init(name) {
      check(!repos.length, 'Component initialized twice');
      repo = ns.platformRepository.createRepository({name});
      const second = ns.platformRepository.createRepository({name});
      const faultRepo = ns.platformRepository.createRepository({name,
        fault: stage => fault?.stage === stage ? fault.code : null});
      repos = [repo, second, faultRepo];
      const guarded = value => ({...value, commit: async batch => {
        if (raceGate) {
          const gate = raceGate; gate.arrivals++;
          if (gate.arrivals === 2) gate.release();
          await gate.promise;
        }
        return value.commit(batch);
      }});
      a = controller(guarded(repo)); b = controller(guarded(second)); failing = controller(faultRepo);
      a.loadStudy(input);
      const saved = await a.save();
      initial = await repo.read('supplyStudies', saved.pointer.inputHash);
      check(saved.pointer.revision === 1 && initial, 'Initial component save was not durable');
      return {database: name, counts: await counts(), revision: 1,
        method: 'NATIVE_INDEXEDDB_PRODUCTION_MODULE_COMPONENT_NOT_UI'};
    },
    async cycle() {
      const number = completed + 1, id = 'SUPPLY:' + input.studyId;
      const previous = await repo.read('pointers', id);
      await Promise.all([a.reopen(id), b.reopen(id)]);
      a.updateStudy({name: 'Synthetic concurrent A ' + number});
      b.updateStudy({name: 'Synthetic concurrent B ' + number});
      const beforeA = a.snapshot(), beforeB = b.snapshot();
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      const gate = raceGate = {arrivals: 0, promise, release};
      let timer, outcomes;
      try {
        outcomes = await Promise.race([Promise.allSettled([a.save(), b.save()]),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error('CAS commit barrier stalled')), 5000); })]);
      } finally { clearTimeout(timer); raceGate = null; gate.release(); }
      check(gate.arrivals === 2, 'Both writers must reach the native transaction CAS');
      const winners = outcomes.filter(row => row.status === 'fulfilled');
      const losers = outcomes.filter(row => row.status === 'rejected');
      check(winners.length === 1 && losers.length === 1 && losers[0].reason.code === 'REVISION_CONFLICT',
        'Native two-connection CAS must have exactly one winner and one conflict');
      const winner = winners[0].value.pointer;
      check(winner.revision === previous.revision + 1, 'CAS revision skipped or repeated');
      check(same(await repo.read('pointers', id), winner), 'CAS success receipt differs from durable pointer');
      const loser = outcomes[0].status === 'rejected' ? a : b;
      check(same(loser.snapshot(), outcomes[0].status === 'rejected' ? beforeA : beforeB),
        'Failed CAS falsely changed controller receipt');
      const beforeCounts = await counts(), stage = stages[(number - 1) % stages.length];
      for (const [injected, expected] of [['QuotaExceededError', 'STORAGE_QUOTA_EXCEEDED'],
        ['STORAGE_TRANSACTION_FAILED', 'STORAGE_TRANSACTION_FAILED']]) {
        await failing.reopen(id);
        failing.updateStudy({name: 'Rejected synthetic ' + injected + ' ' + number});
        const before = failing.snapshot();
        fault = {stage, code: injected};
        try { await reject(failing.save(), expected); } finally { fault = null; }
        check(same(failing.snapshot(), before), 'Failed transaction falsely changed controller receipt');
        check(same(await repo.read('pointers', id), winner), 'Aborted transaction changed live pointer');
        check(!await repo.read('supplyStudies', before.study.inputHash), 'Aborted transaction leaked immutable record');
        check(same(await counts(), beforeCounts), 'Aborted transaction leaked audit/record/pointer');
      }
      completed = number;
      check(beforeCounts.supplyStudies === number + 1 && beforeCounts.audit === number + 1,
        'Successful saves must add exactly one immutable version and audit');
      check(beforeCounts.pointers === 1 && beforeCounts.supplySnapshots === 0,
        'Component database cardinality escaped the bounded fixture');
      check(same(await repo.read('supplyStudies', initial.id), initial), 'Original history was mutated');
      await a.openVersion(initial.id);
      check(a.snapshot().study.inputHash === initial.id, 'Historical read returned current version');
      check(same(await repo.read('pointers', id), winner), 'Historical read changed current pointer');
      await a.reopen(id);
      check(a.snapshot().study.inputHash === winner.inputHash, 'Reopen did not restore current version');
      const fullHistory = number % 25 === 0 ? await verifyHistory() : null;
      return {cycle: number, revision: winner.revision, winnerHash: winner.inputHash,
        faultStage: stage, casMethod: 'TWO_REAL_CONNECTIONS_CONTROLLED_PRECOMMIT_BARRIER', quotaRollbacks: 1, transactionAborts: 1, casConflicts: 1,
        immutableHistoryReadbacks: 1, counts: beforeCounts, fullHistory};
    },
    async finish() {
      return {completed, counts: await counts(), ...await verifyHistory(),
        faultMethod: 'CONTROLLED_EXISTING_FAULT_SEAM_NATIVE_ATOMIC_ABORT_NOT_DISK_EXHAUSTION'};
    },
    close() { for (const value of repos) value.close(); repos = []; }
  };
})();
