(function (root) {
  'use strict';
  root.__tests = root.__tests || [];

  /* F07 保存/删除：删除与并发保存必须做版本比较（CAS）。
   * 向量来源：审查包 evidence/repros/delete_save_race.json
   * （删除读 rev1，另一操作保存 rev2，旧删除仍删掉 rev2 指针，新 payload 孤立）。
   * “另一操作”用独立 controller 会话共享同一合成仓储模拟。
   * 断言只看 deleteStudy 的公开结果与仓储公开 read() 回读。 */

  function studyInput(name) {
    return {
      studyId: 'STUDY-RACE',
      name,
      unit: 'm3',
      nodes: [
        { nodeId: 'W', role: 'DC', name: 'Warehouse' },
        { nodeId: 'CUSTOMER:1', role: 'CUSTOMER', name: 'Customer1' }
      ],
      periodDemand: [{ demandId: 'D1', customerNodeId: 'CUSTOMER:1', period: '2026-01', quantity: 10, unit: 'm3' }]
    };
  }

  root.__tests.push({
    id: 'F07',
    title: '删除与并发保存必须比较 expectedRevision（不得删掉 rev2）',
    run: async () => {
      const Controller = root.STCTPlatformV19.supplyChainController;
      const stub = root.STCTMemRepo.createRepository();
      const makeController = () => Controller.createController({ repository: stub });

      // 初始保存 → 指针 rev1
      const controller1 = makeController();
      controller1.loadStudy(studyInput('v1'));
      const saved1 = await controller1.save();
      const pointerId = saved1.pointer.id;

      // “另一操作”：独立会话（共享仓储），随后保存 rev2
      const controller2 = makeController();

      // 删除流程的第 2 次仓储操作挂起（读到 rev1 之后、删除/墓碑提交之前的竞态窗口；
      // 不依赖被测实现的内部步骤），等待期间 rev2 落库
      const gate = stub.__gateOp({ store: 'pointers', skip: 1 });
      const pendingDelete = controller1.deleteStudy(pointerId);
      pendingDelete.catch(() => { });
      const gateHit = await Promise.race([gate.hit, new Promise(resolve => setTimeout(() => resolve('GATE_TIMEOUT'), 3000))]);

      await controller2.reopen(pointerId);
      controller2.updateStudy({ name: 'v2' });
      const saved2 = await controller2.save(); // rev2 落库（新 payload）
      const rev2RecordRef = (saved2.pointer.refs || []).find(row => row.store === 'supplyStudies');

      gate.release();
      const deleteOutcome = await pendingDelete.then(
        result => ({ status: result.status, removed: result.removed }),
        error => ({ errorCode: error.code || error.message })
      );

      const pointerAfter = await stub.read('pointers', pointerId);
      const rev2Record = rev2RecordRef ? await stub.read('supplyStudies', rev2RecordRef.id) : null;

      const conflictReported = deleteOutcome.errorCode === 'REVISION_CONFLICT' || /CONFLICT/i.test(String(deleteOutcome.status || ''));
      const rev2Intact = Boolean(pointerAfter && pointerAfter.revision === 2);
      const rev2RecordIntact = Boolean(rev2Record);
      const pass = conflictReported && rev2Intact && rev2RecordIntact;

      return {
        pass,
        expected: '删除读到 rev1、并发保存产生 rev2 时：删除必须按 expectedRevision=rev1 做比较（同一事务读取并比较），冲突返回 REVISION_CONFLICT 且不清理内容——rev2 指针与 rev2 payload 必须原样保留。',
        actual: {
          raceWindow: gateHit === 'GATE_TIMEOUT' ? 'GATE_TIMEOUT（未观测到竞态窗口）' : 'OK',
          savedRevisions: { beforeDelete: saved1.pointer.revision, concurrent: saved2.pointer.revision },
          deleteOutcome,
          pointerAfter: pointerAfter ? { revision: pointerAfter.revision, inputHash: pointerAfter.inputHash || null } : null,
          rev2RecordAlive: rev2RecordIntact
        }
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
