(function (root) {
  'use strict';
  root.__tests = root.__tests || [];

  /* F01 结论文案：报告文字（findings 的 text/talk）与渲染全文不得硬编码地名/话术，
   * 改善百分比必须来自夹具计算值，不得写死 4% 之类的假数字。
   * 向量来源：审查包 evidence/repros/shared_customer_model.json 的旧错误文案反例
   * （“天津仓甩掉远距离客户，西安仓接手中原方向”“再省约 4%”“3.6%”“四仓”等硬编码）。
   * 夹具为非 UC 全合成研究：节点/客户全部虚构名，改善幅度做成约 50%，
   * 经公开 API（createStudy/evaluatePortfolio/createSnapshot）构造真实快照，
   * 只做向量构造，不冒充原生求解；断言只看 buildModel/render 的公开输出。 */

  const PERIODS = ['2026-01', '2026-02'];
  const BASIS = 'VERIFIED_ROAD';

  function buildViewState() {
    const Design = root.STCTPlatformV19.supplyChainDesign;
    const Report = root.STCTPlatformV19.supplyChainReport;
    const raw = {
      studyId: 'SYNTHETIC-F01',
      name: 'F01 合成文案研究（改善约 50%）',
      classification: 'SYNTHETIC',
      coordinateUse: 'ASSUMED_WGS84_SCREENING',
      nodes: [
        { nodeId: 'SF', name: '合成工厂源', role: 'FACTORY', coordinate: [115, 30] },
        { nodeId: 'HA', name: '合成华北仓', role: 'DC', coordinate: [115.2, 30], capacityByPeriod: { '2026-01': 1000, '2026-02': 1000 } },
        { nodeId: 'HB', name: '合成华南仓', role: 'DC', coordinate: [115.8, 30], capacityByPeriod: { '2026-01': 1000, '2026-02': 1000 } },
        { nodeId: 'CC', name: '合成远端客户', role: 'CUSTOMER', coordinate: [115.6, 30], address: '测试用虚构地址' }
      ],
      periodDemand: PERIODS.map(period => ({ demandId: 'D1', customerNodeId: 'CC', currentSiteId: 'HA', period, quantity: 10, unit: 'm3' })),
      observedInbound: PERIODS.map(period => ({ flowId: 'IN1', fromNodeId: 'SF', toNodeId: 'HA', period, quantity: 10, unit: 'm3' })),
      distanceRows: [
        { fromNodeId: 'SF', toNodeId: 'HA', distanceKm: 1, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 60 },
        { fromNodeId: 'SF', toNodeId: 'HB', distanceKm: 1, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 60 },
        { fromNodeId: 'HA', toNodeId: 'CC', distanceKm: 10, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 600 },
        { fromNodeId: 'HB', toNodeId: 'CC', distanceKm: 5, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 300 }
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
    const common = { type: 'NETWORK_CANDIDATE', objective: 'COST', objectiveScope: 'TWO_END', facilityCounts: [1, 2], distanceBasis: BASIS, oneTimeConversionCost: 0 };
    // 候选：把需求记录改由更近的合成华南仓服务（10km → 5km，约 50% 改善）
    const near = Design.evaluatePortfolio(study, {
      ...common, scenarioId: 'NEAR-HB', selectedSiteIds: ['HB'],
      sourcePlan: [{ sourceNodeId: 'SF', siteNodeId: 'HB', share: 1 }]
    }, [{ demandId: 'D1', siteNodeId: 'HB' }]);
    const snapshot = Report.createSnapshot(study, baseline, [near], [], common);
    return { study, snapshot };
  }

  root.__tests.push({
    id: 'F01',
    title: '结论文案不得硬编码地名/话术，改善百分比必须与夹具一致（约 50%，绝不是 4%）',
    run: async () => {
      const ReportView = root.STCTPlatformV19.supplyChainReportView;
      const { study, snapshot } = buildViewState();

      let model = null, html = null, buildError = null;
      try {
        model = ReportView.buildModel({ study, snapshot });
        html = ReportView.render(model);
      } catch (error) {
        buildError = error;
      }
      if (buildError) {
        return {
          pass: false,
          expected: 'buildModel/render 应产出合成研究报告文案；findings 的 text/talk 与 render 全文不含硬编码（天津/西安/沈阳/4%/3.6%/四仓/四 个），改善百分比与夹具一致（49%~51%）。',
          actual: { buildModelError: buildError.code || buildError.message }
        };
      }

      // 1) 硬编码扫描：findings 全部 text/talk + render(model) 全文
      const forbidden = ['天津', '西安', '沈阳', '4%', '3.6%', '四仓', '四 个'];
      const findingTexts = [];
      for (const f of model.findings || []) {
        findingTexts.push({ findingId: f.findingId, field: 'text', value: String(f.text || '') });
        findingTexts.push({ findingId: f.findingId, field: 'talk', value: String(f.talk || '') });
      }
      const hits = [];
      for (const item of findingTexts) {
        for (const token of forbidden) {
          if (item.value.indexOf(token) >= 0) hits.push({ where: item.findingId + '.' + item.field, token });
        }
      }
      for (const token of forbidden) {
        if (String(html).indexOf(token) >= 0) hits.push({ where: 'render', token });
      }

      // 2) 改善百分比与夹具一致：夹具真实改善 = |outbound 加权距离变化率|（10km → 5km = 50%）
      const f01 = (model.findings || []).find(f => f.findingId === 'F-01') || null;
      const copy = ((f01 && f01.text) || '') + ' ' + ((f01 && f01.talk) || '');
      const pctTokens = [];
      const re = /(\d+(?:\.\d+)?)\s*%/g;
      let match;
      while ((match = re.exec(copy)) !== null) pctTokens.push(Number(match[1]));
      const fixtureRate = Number(((model.reference && model.reference.common && model.reference.common.changeRate) || 0));
      const fixturePct = Math.abs(fixtureRate * 100); // 期望 ≈ 50
      const pctInFixtureRange = pctTokens.length > 0 && pctTokens.every(v => v >= 49 && v <= 51);
      const pctMatchesFixture = pctTokens.length > 0 && pctTokens.every(v => Math.abs(v - fixturePct) <= 1);

      const pass = hits.length === 0 && pctInFixtureRange && pctMatchesFixture;

      return {
        pass,
        expected: `非 UC 合成研究（虚构节点/客户名，10km→5km 约 50% 改善）下：findings 全部 text/talk 与 render(model) 全文不得含 ${forbidden.join(' / ')} 中任一硬编码；F-01 文案中的改善百分比应落在 49%~51% 并与夹具计算值（${fixturePct.toFixed(2)}%）一致，绝不是 4%。`,
        actual: {
          forbiddenHits: hits,
          f01PctTokens: pctTokens,
          fixtureImprovementPct: Number(fixturePct.toFixed(2)),
          f01Text: f01 ? f01.text : null,
          f01Talk: f01 ? f01.talk : null
        }
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
