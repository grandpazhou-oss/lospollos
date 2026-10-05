(function (root) {
  'use strict';
  root.__tests = root.__tests || [];

  /* F08 改配计数口径：M-CHANGED = 改配的需求记录数（demandId 口径），
   * 不是期间行数、不是客户节点数；F-02 文案把"记录数"与"客户节点数"分开表述；
   * 腿差额分解按队列配对（键=toNodeId|period|quantity），同客户多需求不互相覆盖，
   * 不得把两条需求合并成 2 倍差额（对账 deltaSum 必须等于 deltaRef）。
   * 向量来源：审查包 evidence/repros/shared_customer_model.json 语义
   * （2 需求记录、1 客户节点、4 期间行；旧错误 M-CHANGED=期间行/客户口径、
   *   deltaSum -800 vs deltaRef -400、文案"4 个客户"）。
   * 夹具经公开 API（createStudy/evaluatePortfolio/createSnapshot）构造真实快照，
   * 只做向量构造，不冒充原生求解；断言只看 buildModel/render 的公开输出。 */

  const PERIODS = ['2026-01', '2026-02'];
  const BASIS = 'VERIFIED_ROAD';

  // moveIds：要改由合成服务仓Y服务的需求记录（demandId）；其余保持合成服务仓X
  function buildViewState(moveIds) {
    const Design = root.STCTPlatformV19.supplyChainDesign;
    const Report = root.STCTPlatformV19.supplyChainReport;
    const raw = {
      studyId: 'SYNTHETIC-F08',
      name: 'F08 合成共享客户研究（2 需求记录 1 客户节点 4 期间行）',
      classification: 'SYNTHETIC',
      coordinateUse: 'ASSUMED_WGS84_SCREENING',
      nodes: [
        { nodeId: 'F', name: '合成工厂F', role: 'FACTORY', coordinate: [115, 30] },
        { nodeId: 'SX', name: '合成服务仓X', role: 'DC', coordinate: [115.2, 30], capacityByPeriod: { '2026-01': 1000, '2026-02': 1000 } },
        { nodeId: 'SY', name: '合成服务仓Y', role: 'DC', coordinate: [115.5, 30], capacityByPeriod: { '2026-01': 1000, '2026-02': 1000 } },
        { nodeId: 'CC', name: '合成共享客户', role: 'CUSTOMER', coordinate: [115.6, 30], address: '测试用虚构地址' }
      ],
      // 2 条需求记录（D1、D2）共用同一客户节点 CC；D1 物量 10/期、D2 物量 30/期 → 4 条期间行
      periodDemand: [
        { demandId: 'D1', customerNodeId: 'CC', currentSiteId: 'SX', period: '2026-01', quantity: 10, unit: 'm3' },
        { demandId: 'D1', customerNodeId: 'CC', currentSiteId: 'SX', period: '2026-02', quantity: 10, unit: 'm3' },
        { demandId: 'D2', customerNodeId: 'CC', currentSiteId: 'SX', period: '2026-01', quantity: 30, unit: 'm3' },
        { demandId: 'D2', customerNodeId: 'CC', currentSiteId: 'SX', period: '2026-02', quantity: 30, unit: 'm3' }
      ],
      observedInbound: PERIODS.map(period => ({ flowId: 'IN1', fromNodeId: 'F', toNodeId: 'SX', period, quantity: 40, unit: 'm3' })),
      distanceRows: [
        { fromNodeId: 'F', toNodeId: 'SX', distanceKm: 1, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 60 },
        { fromNodeId: 'F', toNodeId: 'SY', distanceKm: 1, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 60 },
        { fromNodeId: 'SX', toNodeId: 'CC', distanceKm: 10, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 600 },
        { fromNodeId: 'SY', toNodeId: 'CC', distanceKm: 5, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 300 }
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
    const study = Design.createStudy(raw);
    const baseline = Design.evaluatePortfolio(study, { type: 'OBSERVED_BASELINE', distanceBasis: BASIS });
    const moved = new Set(moveIds);
    const selected = moved.size === 2 ? ['SY'] : ['SX', 'SY'];
    const common = { type: 'NETWORK_CANDIDATE', objective: 'COST', objectiveScope: 'TWO_END', facilityCounts: [1, 2], distanceBasis: BASIS, oneTimeConversionCost: 0 };
    const candidate = Design.evaluatePortfolio(study, {
      ...common, scenarioId: 'SWAP', selectedSiteIds: selected,
      sourcePlan: selected.map(siteNodeId => ({ sourceNodeId: 'F', siteNodeId, share: 1 }))
    }, [
      { demandId: 'D1', siteNodeId: moved.has('D1') ? 'SY' : 'SX' },
      { demandId: 'D2', siteNodeId: moved.has('D2') ? 'SY' : 'SX' }
    ]);
    const snapshot = Report.createSnapshot(study, baseline, [candidate], [], common);
    return { study, snapshot };
  }

  function f02Counts(model) {
    const f02 = (model.findings || []).find(f => f.findingId === 'F-02') || null;
    const m = f02 && /(\d+)\s*条需求记录换服务仓，涉及\s*(\d+)\s*个客户节点（记录与客户为不同口径）/.exec(String(f02.text || ''));
    return m ? { recordCount: Number(m[1]), customerNodeCount: Number(m[2]), text: f02.text } : { recordCount: null, customerNodeCount: null, text: f02 ? f02.text : null };
  }

  root.__tests.push({
    id: 'F08',
    title: '改配计数 = 需求记录（demandId）口径；F-02 记录/客户分开表述；腿差额按需独立对账',
    run: async () => {
      const ReportView = root.STCTPlatformV19.supplyChainReportView;

      // ---------- 变体 2：两条需求记录都改配（记录 2 / 期间行 4 / 客户节点 1，三个口径互不相同） ----------
      const both = buildViewState(['D1', 'D2']);
      const model2 = ReportView.buildModel({ study: both.study, snapshot: both.snapshot });
      const exRow2 = (both.snapshot.explanation.rows || []).find(r => r.scenarioId === model2.focusId) || null;
      const mChanged2 = (model2.metrics || []).find(m => m.metricId === 'M-CHANGED');
      const demandIds2 = exRow2 ? exRow2.affected.demandIds : null;
      const businessRecords2 = exRow2 ? exRow2.affected.businessRecords : null;
      const periodRecords2 = exRow2 ? exRow2.affected.periodRecords : null;
      const counts2 = f02Counts(model2);

      // ---------- 变体 1：只改配 1 条需求记录（记录 1 / 期间行 2） ----------
      const one = buildViewState(['D1']);
      const model1 = ReportView.buildModel({ study: one.study, snapshot: one.snapshot });
      const exRow1 = (one.snapshot.explanation.rows || []).find(r => r.scenarioId === model1.focusId) || null;
      const mChanged1 = (model1.metrics || []).find(m => m.metricId === 'M-CHANGED');
      const counts1 = f02Counts(model1);

      // ---------- 腿差额独立性（变体 2）：D1(10/期) 与 D2(30/期) 各自成腿，不得合并/加倍 ----------
      // 夹具距离：X→客户 10km、Y→客户 5km → 每条腿差额 = 物量 × (5−10)：D1 腿 −50、D2 腿 −150
      const deltas = [...(model2.deltas.gains || []), ...(model2.deltas.losses || [])];
      const expectedLegs = [
        { period: '2026-01', quantity: 10, deltaVolumeKm: -50 },
        { period: '2026-02', quantity: 10, deltaVolumeKm: -50 },
        { period: '2026-01', quantity: 30, deltaVolumeKm: -150 },
        { period: '2026-02', quantity: 30, deltaVolumeKm: -150 }
      ];
      const legMatches = expectedLegs.map(exp => deltas.some(r =>
        r.period === exp.period
        && Math.abs(Number(r.quantity) - exp.quantity) < 1e-6
        && Math.abs(Number(r.deltaVolumeKm) - exp.deltaVolumeKm) < 1e-6));
      const noMergedLeg = deltas.every(r => ![100, 200, 300, 400].includes(Math.abs(Math.round(Number(r.deltaVolumeKm)))));
      const reconciled = model2.deltas.deltaRef != null
        && Math.abs(Number(model2.deltas.deltaSum) - Number(model2.deltas.deltaRef)) < 1e-6;

      const ok2 = Boolean(mChanged2) && mChanged2.value === 2
        && Boolean(demandIds2) && demandIds2.length === 2
        && businessRecords2 === 2
        && periodRecords2 === 4 && mChanged2.value !== periodRecords2
        && mChanged2.value !== 1 // 不是客户节点数
        && counts2.recordCount === 2 && counts2.customerNodeCount === 1 && counts2.recordCount !== counts2.customerNodeCount;
      const ok1 = Boolean(mChanged1) && mChanged1.value === 1
        && Boolean(exRow1) && exRow1.affected.demandIds.length === 1
        && exRow1.affected.businessRecords === 1
        && exRow1.affected.periodRecords === 2 && mChanged1.value !== exRow1.affected.periodRecords
        && counts1.recordCount === 1 && counts1.customerNodeCount === 1;
      const okDeltas = deltas.length === 4 && legMatches.every(Boolean) && noMergedLeg && reconciled;

      const pass = ok2 && ok1 && okDeltas;

      return {
        pass,
        expected: 'M-CHANGED = 改配需求记录数（demandId 口径）：两条都改 = 2（≠期间行 4、≠客户节点 1），只改 D1 = 1（≠期间行 2）；F-02 文案分开表述“N 条需求记录换服务仓，涉及 M 个客户节点（记录与客户为不同口径）”；同客户两需求（10/期、30/期）的腿差额各自独立（−50 与 −150，不得合并成 2 倍差额），deltaSum 与 deltaRef 对账一致。',
        actual: {
          bothChanged: {
            mChanged: mChanged2 ? mChanged2.value : null,
            affectedDemandIds: demandIds2,
            affectedBusinessRecords: businessRecords2,
            affectedPeriodRecords: periodRecords2,
            f02RecordCount: counts2.recordCount,
            f02CustomerNodeCount: counts2.customerNodeCount,
            f02Text: counts2.text
          },
          oneChanged: {
            mChanged: mChanged1 ? mChanged1.value : null,
            affectedDemandIds: exRow1 ? exRow1.affected.demandIds : null,
            affectedBusinessRecords: exRow1 ? exRow1.affected.businessRecords : null,
            affectedPeriodRecords: exRow1 ? exRow1.affected.periodRecords : null,
            f02RecordCount: counts1.recordCount,
            f02CustomerNodeCount: counts1.customerNodeCount
          },
          legDeltas: deltas.map(r => ({ period: r.period, quantity: r.quantity, deltaVolumeKm: r.deltaVolumeKm })),
          expectedLegs,
          deltaSum: model2.deltas.deltaSum,
          deltaRef: model2.deltas.deltaRef,
          reconciled
        }
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
