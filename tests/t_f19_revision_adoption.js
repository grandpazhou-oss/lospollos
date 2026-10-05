(function (root) {
  'use strict';
  root.__tests = root.__tests || [];

  /* F19 保存版本收养：草稿/包重导入（savedPointer 被重置）后首次保存不得"自冲突"；
     跨标签真并发（过期会话）仍必须 REVISION_CONFLICT。
     断言只看 controller.save() 公开结果与仓储公开 read() 回读。 */

  function studyInput(studyId, name) {
    return {
      studyId,
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
    id: 'F19',
    title: '重导入收养版本号不自冲突；跨标签过期会话仍冲突',
    run: async () => {
      const Controller = root.STCTPlatformV19.supplyChainController;
      const stub = root.STCTMemRepo.createRepository();
      const c1 = Controller.createController({ repository: stub });

      // 1) 首次保存 → rev1
      c1.loadStudy(studyInput('STUDY-ADOPT', 'v1'));
      const saved1 = await c1.save();

      // 2) 模拟草稿重导入：同 studyId 重新载入（loadStudy 会重置 savedPointer）
      c1.loadStudy(studyInput('STUDY-ADOPT', 'v1-reimported'));
      let reimportSave = null;
      try { reimportSave = await c1.save(); } catch (e) { reimportSave = { error: e.code || e.message }; }
      const pointerAfterAdopt = await stub.read('pointers', 'SUPPLY:STUDY-ADOPT');

      // 3) 跨标签：独立会话 reopen 到最新版并保存 rev3
      const c2 = Controller.createController({ repository: stub });
      await c2.reopen('SUPPLY:STUDY-ADOPT');
      c2.updateStudy({ name: 'v2-from-tab2' });
      const saved3 = await c2.save();

      // 4) 本会话（savedPointer 停在 rev2）再保存 → 必须 REVISION_CONFLICT
      c1.updateStudy({ name: 'v3-stale-tab1' });
      let c1Result = null;
      try { c1Result = await c1.save(); } catch (e) { c1Result = { error: e.code || e.message }; }

      const pointerFinal = await stub.read('pointers', 'SUPPLY:STUDY-ADOPT');
      const adoptedOk = !reimportSave.error && pointerAfterAdopt && pointerAfterAdopt.revision === 2;
      const crossTabOk = Boolean(c1Result && c1Result.error === 'REVISION_CONFLICT');
      const pass = Boolean(adoptedOk && crossTabOk && pointerFinal && pointerFinal.revision === 3);

      return {
        pass,
        expected: '重导入后保存成功（收养 rev1→2）；过期会话保存得 REVISION_CONFLICT；最终 rev3',
        actual: {
          firstSaveRevision: saved1.pointer.revision,
          reimportSave: reimportSave.error ? { error: reimportSave.error } : { revision: reimportSave.pointer.revision },
          revAfterAdopt: pointerAfterAdopt && pointerAfterAdopt.revision,
          tab2Save: saved3.pointer.revision,
          staleTab1Save: c1Result,
          finalRevision: pointerFinal && pointerFinal.revision
        }
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
