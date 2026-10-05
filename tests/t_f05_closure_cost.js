(function (root) {
  'use strict';
  root.__tests = root.__tests || [];

  /* F05 费用结论：关仓盈亏平衡必须计入全部已声明适用费用（含处理费）。
   * 向量来源：审查包 evidence/repros/closure_cost.json 及其生成脚本
   * scripts_as_executed/cost_review.js 的合成费用管线（全部合成费用，非 UC 金额）：
   *   观察现状 base   = 入库20 + 配送120 + 固定0   + 处理1000 = 1140
   *   焦点 FULL-A     = 入库20 + 配送100 + 固定200 + 处理0    = 320
   *   关仓 CLOSE-A    = 入库20 + 配送120 + 固定0   + 处理1000 = 1140
   *   2 期 → 关仓相对焦点方案每期 +410（运输+10、处理+500、固定−100）。
   * 期望：关仓判定反映每期 +410（处理费导致），不得显示“净省 90 / 已划算”。
   * 夹具经公开 API（createStudy/evaluatePortfolio/createSnapshot）构造真实快照，
   * 只做向量构造，不冒充原生求解；断言只看 buildModel/render 的公开输出。 */

  const PERIODS = ['2026-01', '2026-02'];

  function buildViewState() {
    const Design = root.STCTPlatformV19.supplyChainDesign;
    const Report = root.STCTPlatformV19.supplyChainReport;
    const raw = {
      studyId: 'SYNTHETIC-F05',
      name: 'F05 合成费用反例（320→1140）',
      classification: 'SYNTHETIC',
      coordinateUse: 'ASSUMED_WGS84_SCREENING',
      nodes: [
        { nodeId: 'F', name: '合成工厂F', role: 'FACTORY', coordinate: [115, 30] },
        { nodeId: 'A', name: '合成仓A', role: 'DC', coordinate: [115.2, 30], capacityByPeriod: { '2026-01': 1000, '2026-02': 1000 } },
        { nodeId: 'B', name: '合成仓B', role: 'DC', coordinate: [115.5, 30], capacityByPeriod: { '2026-01': 1000, '2026-02': 1000 } },
        { nodeId: 'C', name: '合成客户C', role: 'CUSTOMER', coordinate: [115.6, 30], address: '测试用虚构地址' }
      ],
      periodDemand: PERIODS.map(period => ({ demandId: 'D1', customerNodeId: 'C', currentSiteId: 'B', period, quantity: 10, unit: 'm3' })),
      observedInbound: PERIODS.map(period => ({ flowId: 'IN1', fromNodeId: 'F', toNodeId: 'B', period, quantity: 10, unit: 'm3' })),
      distanceRows: [
        { fromNodeId: 'F', toNodeId: 'A', distanceKm: 1, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 60 },
        { fromNodeId: 'F', toNodeId: 'B', distanceKm: 1, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 60 },
        { fromNodeId: 'A', toNodeId: 'C', distanceKm: 5, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 300 },
        { fromNodeId: 'B', toNodeId: 'C', distanceKm: 6, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 360 }
      ],
      rates: [
        { kind: 'INBOUND_TRANSPORT', status: 'ASSUMED', basis: 'PER_UNIT_KM', amount: 1 },
        { kind: 'OUTBOUND_TRANSPORT', status: 'ASSUMED', basis: 'PER_UNIT_KM', amount: 1 },
        { kind: 'FIXED_OPERATING', fromNodeId: 'A', toNodeId: 'A', status: 'KNOWN', amount: 100, basis: 'PER_PERIOD' },
        { kind: 'FIXED_OPERATING', fromNodeId: 'B', toNodeId: 'B', status: 'KNOWN', amount: 0, basis: 'PER_PERIOD' },
        { kind: 'HANDLING', fromNodeId: 'A', toNodeId: 'A', status: 'KNOWN', amount: 0, basis: 'PER_UNIT' },
        { kind: 'HANDLING', fromNodeId: 'B', toNodeId: 'B', status: 'KNOWN', amount: 50, basis: 'PER_UNIT' }
      ],
      costApplicability: { inventoryHolding: 'NOT_APPLICABLE', transferTransport: 'NOT_APPLICABLE' },
      assumptions: { homogeneousGoods: true }
    };
    const study = Design.createStudy(raw);
    const basis = 'VERIFIED_ROAD';
    const baseline = Design.evaluatePortfolio(study, { type: 'OBSERVED_BASELINE', distanceBasis: basis });
    const common = { type: 'NETWORK_CANDIDATE', objective: 'COST', objectiveScope: 'TWO_END', facilityCounts: [1, 2], distanceBasis: basis, oneTimeConversionCost: 0 };
    const focus = Design.evaluatePortfolio(study, {
      ...common, scenarioId: 'FULL-A', selectedSiteIds: ['A', 'B'],
      sourcePlan: [{ sourceNodeId: 'F', siteNodeId: 'A', share: 1 }, { sourceNodeId: 'F', siteNodeId: 'B', share: 1 }]
    }, [{ demandId: 'D1', siteNodeId: 'A' }]);
    const closure = Design.evaluatePortfolio(study, {
      ...common, scenarioId: 'CLOSE-A', selectedSiteIds: ['B'],
      sourcePlan: [{ sourceNodeId: 'F', siteNodeId: 'B', share: 1 }]
    }, [{ demandId: 'D1', siteNodeId: 'B' }]);
    const snapshot = Report.createSnapshot(study, baseline, [focus, closure], [], common);
    return { study, snapshot, focus, closure };
  }

  function closureRowText(html) {
    const start = html.indexOf('关仓运输代价参考');
    if (start < 0) return null;
    const end = html.indexOf('</table>', start);
    const region = html.slice(start, end < 0 ? undefined : end);
    const rows = region.match(/<tr[\s\S]*?<\/tr>/g) || [];
    const target = rows.find(row => row.indexOf('合成仓A') >= 0);
    return target ? target.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : null;
  }

  root.__tests.push({
    id: 'F05',
    title: '关仓盈亏平衡必须计入处理费（每期 +410，不得显示净省 90）',
    run: async () => {
      const ReportView = root.STCTPlatformV19.supplyChainReportView;
      const { study, snapshot, focus, closure } = buildViewState();
      const truePerPeriodIncrease = (closure.metrics.steadyStateCost - focus.metrics.steadyStateCost) / PERIODS.length;

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
          expected: `关仓判定必须反映相对焦点方案每期已知总成本 +${truePerPeriodIncrease}（运输 +10、处理费 +500、固定 −100；处理费 1000/2 期不可漏算），不得显示“净省 90 / 已划算”。`,
          actual: { buildModelError: buildError.code || buildError.message }
        };
      }

      const verdictRow = closureRowText(html);
      const entry = (model.closures || []).find(row => row.scenarioId === 'CLOSE-A') || null;
      const claimsPayoff = /已划算|净省/.test(verdictRow || '');
      const reflectsIncrease = verdictRow ? verdictRow.indexOf(String(truePerPeriodIncrease)) >= 0 : false;
      const pass = Boolean(entry) && Boolean(verdictRow) && !claimsPayoff && reflectsIncrease;

      return {
        pass,
        expected: `关仓判定必须反映相对焦点方案每期已知总成本 +${truePerPeriodIncrease}（320→1140/2 期；运输 +10、处理费 +500、固定 −100，处理费 1000/2 期不可漏算），不得显示“净省 90 / 已划算”。`,
        actual: {
          truePerPeriodIncrease,
          closureCostParts: closure.metrics.costParts,
          focusCostParts: focus.metrics.costParts,
          closedSites: entry ? entry.closedSites : null,
          transportPenaltyCostPerPeriod: entry ? entry.transportPenaltyCost : null,
          fixedSavingPerPeriod: entry ? entry.fixedSaving : null,
          verdictRow: verdictRow
        }
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
