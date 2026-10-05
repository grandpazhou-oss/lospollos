(function (root) {
  'use strict';
  root.__tests = root.__tests || [];

  /* F06 研究身份：历史版本迟到的响应不得覆盖新研究。
   * 向量来源：审查包 evidence/repros/open_version_race.json（期望 B-NEW，实际 A-OLD）。
   * 用合成仓储（tests/helpers_memrepo.js）把 A 的 pointer 读取挂起，
   * 期间完整打开 B，再放行 A。断言只看 controller 公开 viewState()。 */

  const STUDY_A = {
    studyId: 'STUDY-A',
    name: 'A-OLD',
    unit: 'm3',
    nodes: [
      { nodeId: 'W', role: 'DC', name: 'Warehouse' },
      { nodeId: 'CUSTOMER:1', role: 'CUSTOMER', name: 'Customer1' }
    ],
    periodDemand: [{ demandId: 'D1', customerNodeId: 'CUSTOMER:1', period: '2026-01', quantity: 10, unit: 'm3' }]
  };
  const STUDY_B = {
    studyId: 'STUDY-B',
    name: 'B-NEW',
    unit: 'm3',
    nodes: [
      { nodeId: 'W', role: 'DC', name: 'Warehouse' },
      { nodeId: 'CUSTOMER:1', role: 'CUSTOMER', name: 'Customer1' }
    ],
    periodDemand: [{ demandId: 'D1', customerNodeId: 'CUSTOMER:1', period: '2026-02', quantity: 20, unit: 'm3' }]
  };

  const withTimeout = (promise, ms, fallback) => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(fallback), ms))]);

  root.__tests.push({
    id: 'F06',
    title: 'openVersion 迟到的旧研究响应不得覆盖新研究（操作纪元竞态）',
    run: async () => {
      const stub = root.STCTMemRepo.createRepository();
      stub.__seed('supplyStudies', [stub.record('A-OLD', STUDY_A), stub.record('B-NEW', STUDY_B)]);
      const controller = root.STCTPlatformV19.supplyChainController.createController({ repository: stub });

      // A 的 pointer 读取（openVersion 末段）挂起，制造迟到响应窗口
      const gate = stub.__gateRead({ store: 'pointers', id: 'SUPPLY:STUDY-A' });
      const pendingA = controller.openVersion('A-OLD');
      pendingA.catch(() => { });
      const gateHit = await withTimeout(gate.hit, 3000, 'GATE_TIMEOUT');

      // 期间完整打开 B
      await controller.openVersion('B-NEW');
      const stateAfterB = controller.viewState();

      // 放行 A 的迟到读取
      gate.release();
      const outcomeA = await pendingA.then(() => 'RESOLVED', error => error.code || error.message);

      const state = controller.viewState();
      const finalStudyId = state.study ? state.study.studyId : null;
      const pass = finalStudyId === 'STUDY-B';

      return {
        pass,
        expected: '最终 state.study 必须是 B（studyId=STUDY-B，status=STUDY_READY）；A 的迟到响应只允许被拒绝/忽略（如 SUPPLY_RUN_OBSOLETE），不得在 B 之后覆盖当前研究。',
        actual: {
          raceWindow: gateHit === 'GATE_TIMEOUT' ? 'GATE_TIMEOUT（未观测到挂起读取）' : 'OK',
          outcomeA,
          studyIdAfterB: stateAfterB.study ? stateAfterB.study.studyId : null,
          finalStudyId,
          finalStudyName: state.study ? state.study.name : null,
          finalStatus: state.status
        }
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
