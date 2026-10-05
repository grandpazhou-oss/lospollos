(function (root) {
  'use strict';
  root.__tests = root.__tests || [];

  /* F12 快照可信：新报告入口必须校验研究/快照一致性。
   * 向量：同一输入管线生成真实快照（studyHash=旧研究），再把“新 study.inputHash”
   * 的研究与该旧快照一起交给 buildModel——必须抛快照不一致/过期错误，不得出报告。
   * 夹具经公开 API（createStudy/evaluatePortfolio/createSnapshot）构造，仅作向量；
   * 断言只看 supplyChainReportView.buildModel 的公开抛错/返回。 */

  const PERIODS = ['2026-01', '2026-02'];

  function rawStudy(studyId, name) {
    return {
      studyId,
      name,
      classification: 'SYNTHETIC',
      coordinateUse: 'ASSUMED_WGS84_SCREENING',
      nodes: [
        { nodeId: 'F', name: '合成工厂F', role: 'FACTORY', coordinate: [115, 30] },
        { nodeId: 'A', name: '合成仓A', role: 'DC', coordinate: [115.2, 30], capacityByPeriod: { '2026-01': 1000, '2026-02': 1000 } },
        { nodeId: 'C', name: '合成客户C', role: 'CUSTOMER', coordinate: [115.6, 30], address: '测试用虚构地址' }
      ],
      periodDemand: PERIODS.map(period => ({ demandId: 'D1', customerNodeId: 'C', currentSiteId: 'A', period, quantity: 10, unit: 'm3' })),
      observedInbound: PERIODS.map(period => ({ flowId: 'IN1', fromNodeId: 'F', toNodeId: 'A', period, quantity: 10, unit: 'm3' })),
      distanceRows: [
        { fromNodeId: 'F', toNodeId: 'A', distanceKm: 1, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 60 },
        { fromNodeId: 'A', toNodeId: 'C', distanceKm: 5, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 300 }
      ],
      rates: [
        { kind: 'INBOUND_TRANSPORT', status: 'ASSUMED', basis: 'PER_UNIT_KM', amount: 1 },
        { kind: 'OUTBOUND_TRANSPORT', status: 'ASSUMED', basis: 'PER_UNIT_KM', amount: 1 },
        { kind: 'FIXED_OPERATING', status: 'CONFIRMED_ZERO', basis: 'PER_PERIOD', amount: 0 },
        { kind: 'HANDLING', status: 'CONFIRMED_ZERO', basis: 'PER_UNIT', amount: 0 }
      ],
      costApplicability: { inventoryHolding: 'NOT_APPLICABLE', transferTransport: 'NOT_APPLICABLE' },
      assumptions: { homogeneousGoods: true }
    };
  }

  function staleSnapshotFor() {
    const Design = root.STCTPlatformV19.supplyChainDesign;
    const Report = root.STCTPlatformV19.supplyChainReport;
    const studyOld = Design.createStudy(rawStudy('SYNTHETIC-F12-OLD', '旧研究（快照归属）'));
    const baseline = Design.evaluatePortfolio(studyOld, { type: 'OBSERVED_BASELINE', distanceBasis: 'VERIFIED_ROAD' });
    const scenario = {
      type: 'NETWORK_CANDIDATE', scenarioId: 'SYNTHETIC-A', distanceBasis: 'VERIFIED_ROAD',
      selectedSiteIds: ['A'], sourcePlan: [{ sourceNodeId: 'F', siteNodeId: 'A', share: 1 }],
      oneTimeConversionCost: 0, objective: 'VOLUME_KM', objectiveScope: 'TWO_END', facilityCounts: [1]
    };
    const candidate = Design.evaluatePortfolio(studyOld, scenario, [{ demandId: 'D1', siteNodeId: 'A' }]);
    return Report.createSnapshot(studyOld, baseline, [candidate], [], scenario);
  }

  root.__tests.push({
    id: 'F12',
    title: 'buildModel 必须拒绝研究/快照身份不一致（不得绕过 assertCurrent）',
    run: async () => {
      const Design = root.STCTPlatformV19.supplyChainDesign;
      const ReportView = root.STCTPlatformV19.supplyChainReportView;

      const snapshot = staleSnapshotFor(); // studyHash = 旧研究 inputHash
      const study = Design.createStudy(rawStudy('SYNTHETIC-F12-NEW', '新研究（输入已变更）')); // 新 inputHash

      let thrown = null;
      let model = null;
      try {
        model = ReportView.buildModel({ study, snapshot });
      } catch (error) {
        thrown = error;
      }

      const staleness = /STALE|MISMATCH|INCONSISTENT|OBSOLETE|CONFLICT/i;
      const rejected = Boolean(thrown) && staleness.test(String(thrown.code || thrown.message || ''));
      const pass = rejected;

      return {
        pass,
        expected: 'study.inputHash 与 snapshot.studyHash 不一致（新研究 + 旧快照）时，buildModel 必须抛出快照不一致/过期错误（如 SUPPLY_SNAPSHOT_STALE），不得产出报告模型。',
        actual: thrown
          ? { rejected: true, studyInputHash: study.inputHash, snapshotStudyHash: snapshot.studyHash, errorCode: thrown.code || null }
          : {
            rejected: false,
            returnedModel: true,
            studyInputHash: study.inputHash,
            snapshotStudyHash: snapshot.studyHash,
            identity: model && model.identity ? { inputHash: model.identity.inputHash, snapshotHash: model.identity.snapshotHash } : null
          }
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
