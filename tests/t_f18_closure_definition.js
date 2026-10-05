(function (root) {
  'use strict';
  root.__tests = root.__tests || [];

  /* F18 关闭定义：closures[].closedSites = 焦点（推荐）方案启用 − 候选启用，
   * 即"相对推荐方案关闭了真启用过的仓"；从未启用的候选仓（只作为可选仓存在、
   * 任何方案都不选它）绝不出现在 closedSites。候选比较表行文案 displayRows[].sites
   * 的“（关闭：X）”标签 = 参照启用 − 候选启用。
   * 反例来源：审查包 evidence/repros/future_site_as_closure.json 的旧错误输出
   *   closedSites:["未开业的候选仓"]——把从未开业的候选仓当成关仓。
   * 夹具经公开 API（createStudy/evaluatePortfolio/createSnapshot）构造真实快照：
   * 三个 DC：甲、乙（都在焦点方案 FULL-AB 启用）、未开业仓（只作为可选仓存在，
   * 任何方案都不选它）；焦点 [甲,乙]，候选 CLOSE-A [乙]（关甲）。
   * 只做向量构造，不冒充原生求解；断言只看 buildModel/render 的公开输出。 */

  const PERIODS = ['2026-01', '2026-02'];
  const BASIS = 'VERIFIED_ROAD';
  const NAME_A = '合成服务仓甲';
  const NAME_B = '合成服务仓乙';
  const NAME_N = '合成未开业仓';

  function buildViewState() {
    const Design = root.STCTPlatformV19.supplyChainDesign;
    const Report = root.STCTPlatformV19.supplyChainReport;
    const raw = {
      studyId: 'SYNTHETIC-F18',
      name: 'F18 合成关仓定义研究（含未开业候选仓）',
      classification: 'SYNTHETIC',
      coordinateUse: 'ASSUMED_WGS84_SCREENING',
      nodes: [
        { nodeId: 'F', name: '合成工厂F', role: 'FACTORY', coordinate: [115, 30] },
        { nodeId: 'SA', name: NAME_A, role: 'DC', coordinate: [115.2, 30], capacityByPeriod: { '2026-01': 1000, '2026-02': 1000 } },
        { nodeId: 'SB', name: NAME_B, role: 'DC', coordinate: [115.5, 30], capacityByPeriod: { '2026-01': 1000, '2026-02': 1000 } },
        { nodeId: 'SN', name: NAME_N, role: 'DC', coordinate: [115.4, 31], capacityByPeriod: { '2026-01': 1000, '2026-02': 1000 } },
        { nodeId: 'C1', name: '合成近甲客户', role: 'CUSTOMER', coordinate: [115.25, 30], address: '测试用虚构地址1' },
        { nodeId: 'C2', name: '合成近乙客户', role: 'CUSTOMER', coordinate: [115.55, 30], address: '测试用虚构地址2' }
      ],
      periodDemand: [
        { demandId: 'D1', customerNodeId: 'C1', currentSiteId: 'SA', period: '2026-01', quantity: 20, unit: 'm3' },
        { demandId: 'D1', customerNodeId: 'C1', currentSiteId: 'SA', period: '2026-02', quantity: 20, unit: 'm3' },
        { demandId: 'D2', customerNodeId: 'C2', currentSiteId: 'SB', period: '2026-01', quantity: 20, unit: 'm3' },
        { demandId: 'D2', customerNodeId: 'C2', currentSiteId: 'SB', period: '2026-02', quantity: 20, unit: 'm3' }
      ],
      observedInbound: [
        { flowId: 'IN1', fromNodeId: 'F', toNodeId: 'SA', period: '2026-01', quantity: 20, unit: 'm3' },
        { flowId: 'IN1', fromNodeId: 'F', toNodeId: 'SA', period: '2026-02', quantity: 20, unit: 'm3' },
        { flowId: 'IN2', fromNodeId: 'F', toNodeId: 'SB', period: '2026-01', quantity: 20, unit: 'm3' },
        { flowId: 'IN2', fromNodeId: 'F', toNodeId: 'SB', period: '2026-02', quantity: 20, unit: 'm3' }
      ],
      distanceRows: [
        { fromNodeId: 'F', toNodeId: 'SA', distanceKm: 1, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 60 },
        { fromNodeId: 'F', toNodeId: 'SB', distanceKm: 1, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 60 },
        { fromNodeId: 'F', toNodeId: 'SN', distanceKm: 1, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 60 },
        { fromNodeId: 'SA', toNodeId: 'C1', distanceKm: 2, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 120 },
        { fromNodeId: 'SB', toNodeId: 'C1', distanceKm: 12, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 720 },
        { fromNodeId: 'SA', toNodeId: 'C2', distanceKm: 12, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 720 },
        { fromNodeId: 'SB', toNodeId: 'C2', distanceKm: 2, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 120 },
        { fromNodeId: 'SN', toNodeId: 'C1', distanceKm: 8, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 480 },
        { fromNodeId: 'SN', toNodeId: 'C2', distanceKm: 8, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 480 }
      ],
      rates: [
        { kind: 'INBOUND_TRANSPORT', status: 'ASSUMED', basis: 'PER_UNIT_KM', amount: 1 },
        { kind: 'OUTBOUND_TRANSPORT', status: 'ASSUMED', basis: 'PER_UNIT_KM', amount: 1 },
        { kind: 'FIXED_OPERATING', fromNodeId: 'SA', toNodeId: 'SA', status: 'KNOWN', amount: 20, basis: 'PER_PERIOD' },
        { kind: 'FIXED_OPERATING', fromNodeId: 'SB', toNodeId: 'SB', status: 'KNOWN', amount: 20, basis: 'PER_PERIOD' },
        { kind: 'FIXED_OPERATING', fromNodeId: 'SN', toNodeId: 'SN', status: 'KNOWN', amount: 20, basis: 'PER_PERIOD' },
        { kind: 'HANDLING', status: 'CONFIRMED_ZERO', basis: 'PER_UNIT', amount: 0 }
      ],
      costApplicability: { inventoryHolding: 'NOT_APPLICABLE', transferTransport: 'NOT_APPLICABLE' },
      assumptions: { homogeneousGoods: true }
    };
    const study = Design.createStudy(raw);
    const baseline = Design.evaluatePortfolio(study, { type: 'OBSERVED_BASELINE', distanceBasis: BASIS });
    const common = { type: 'NETWORK_CANDIDATE', objective: 'COST', objectiveScope: 'TWO_END', facilityCounts: [1, 2], distanceBasis: BASIS, oneTimeConversionCost: 0 };
    // 焦点（推荐）方案：[甲,乙] 全开，按现状归属服务
    const focus = Design.evaluatePortfolio(study, {
      ...common, scenarioId: 'FULL-AB', selectedSiteIds: ['SA', 'SB'],
      sourcePlan: [{ sourceNodeId: 'F', siteNodeId: 'SA', share: 1 }, { sourceNodeId: 'F', siteNodeId: 'SB', share: 1 }]
    }, [{ demandId: 'D1', siteNodeId: 'SA' }, { demandId: 'D2', siteNodeId: 'SB' }]);
    // 关仓候选：[乙]（关甲）；未开业仓（SN）任何方案都不选
    const closure = Design.evaluatePortfolio(study, {
      ...common, scenarioId: 'CLOSE-A', selectedSiteIds: ['SB'],
      sourcePlan: [{ sourceNodeId: 'F', siteNodeId: 'SB', share: 1 }]
    }, [{ demandId: 'D1', siteNodeId: 'SB' }, { demandId: 'D2', siteNodeId: 'SB' }]);
    const snapshot = Report.createSnapshot(study, baseline, [focus, closure], [], common);
    return { study, snapshot };
  }

  function closureRegion(html) {
    const start = String(html).indexOf('关仓运输代价参考');
    if (start < 0) return null;
    const end = String(html).indexOf('</table>', start);
    return String(html).slice(start, end < 0 ? undefined : end);
  }

  root.__tests.push({
    id: 'F18',
    title: '关闭 = 焦点启用 − 候选启用；从未开业的候选仓绝不出现在 closedSites/关仓表',
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
          expected: `closures[].closedSites 只含“合成服务仓甲”（焦点 [甲,乙] − 候选 [乙]），绝不含“${NAME_N}”；displayRows 的“（关闭：X）”标签 = 参照启用 − 候选启用；render 关仓表内不出现未开业仓名。`,
          actual: { buildModelError: buildError.code || buildError.message }
        };
      }

      const closures = model.closures || [];
      const closeEntry = closures.find(c => c.scenarioId === 'CLOSE-A') || null;
      const closedSites = closeEntry ? closeEntry.closedSites : null;

      // 1) closures：关闭 = 焦点启用 − 候选启用 = [SA] − 只含甲；任何 closedSites 不得含未开业仓
      const closureHasOnlyA = Boolean(closeEntry)
        && Array.isArray(closedSites) && closedSites.length === 1 && closedSites[0] === NAME_A;
      const closureNeverN = closures.every(c => !(c.closedSites || []).includes(NAME_N));

      // 2) 候选比较表行文案：“（关闭：X）”标签 = 参照启用 − 候选启用
      const displayRows = model.displayRows || [];
      const closureLabelRow = displayRows.find(d => String(d.sites).indexOf('（关闭：') >= 0) || null;
      const labelOk = Boolean(closureLabelRow)
        && String(closureLabelRow.sites).indexOf(`（关闭：${NAME_A}）`) >= 0
        && String(closureLabelRow.sites).indexOf(NAME_N) < 0;
      const displayNeverN = displayRows.every(d => String(d.sites).indexOf(NAME_N) < 0);

      // 3) render 全文的关仓表内不出现未开业仓名（反例：closedSites:["未开业的候选仓"]）
      const region = closureRegion(html);
      const regionOk = Boolean(region) && region.indexOf(NAME_A) >= 0 && region.indexOf(NAME_N) < 0;

      const pass = closureHasOnlyA && closureNeverN && labelOk && displayNeverN && regionOk;

      return {
        pass,
        expected: `焦点方案 [${NAME_A},${NAME_B}]、候选 CLOSE-A [${NAME_B}]（关甲）、${NAME_N} 只作为可选仓存在且任何方案都不启用：model.closures 的 closedSites 只含“${NAME_A}”（= 焦点启用 − 候选启用），绝不含“${NAME_N}”；displayRows 行文案“（关闭：${NAME_A}）”= 参照启用 − 候选启用且不含${NAME_N}；render(model) 关仓表内不出现“${NAME_N}”。`,
        actual: {
          focusId: model.focusId,
          closedSitesOfCloseA: closedSites,
          allClosures: closures.map(c => ({ scenarioId: c.scenarioId, closedSites: c.closedSites })),
          closureLabelRowSites: closureLabelRow ? closureLabelRow.sites : null,
          allDisplaySites: displayRows.map(d => d.sites),
          closureRegionHasA: region ? region.indexOf(NAME_A) >= 0 : null,
          closureRegionHasN: region ? region.indexOf(NAME_N) >= 0 : null
        }
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
