(function (root) {
  'use strict';
  root.__tests = root.__tests || [];

  /* F02 快照 schema 分派：buildModel 必须按快照 schemaVersion 分派校验，
   * 不得把联合（V5）快照当旧 Facility 包读取（旧错误：selectedSiteIds TypeError，
   * 见审查包 02_问题台账 F02 / extended_tests.json INTERACTIVE-FULL_CHAIN-build）。
   * 契约：
   *   (1) 'stct-supply-chain-snapshot-v1.9' → supplyChainReport.assertCurrent，buildModel 返回 model；
   *   (2) 未知 schema → 抛 {code:'REPORT_SNAPSHOT_SCHEMA_UNSUPPORTED'}，不得 TypeError；
   *   (3) 'stct-supply-chain-v5-snapshot-v1' → 走 supplyChainV5Results.assertCurrent，
   *       buildModel 不抛 selectedSiteIds TypeError，返回 model 或给出明确结构化错误。
   * 夹具经公开 API 构造真实快照（createStudy/evaluatePortfolio/createSnapshot；
   * V5 走 supplyChainJoint.buildRequest + supplyChainV5Results.fromVerified/createSnapshot），
   * 只做向量构造，不冒充原生求解；断言只看 buildModel 的公开抛错/返回。
   * Native rows carry no legacy result bridge; valid snapshots must return a model. */

  const PERIODS = ['2026-01', '2026-02'];
  const BASIS = 'VERIFIED_ROAD';

  function rawStudy(studyId, name) {
    return {
      studyId,
      name,
      classification: 'SYNTHETIC',
      coordinateUse: 'ASSUMED_WGS84_SCREENING',
      nodes: [
        { nodeId: 'F', name: '合成工厂F', role: 'FACTORY', coordinate: [115, 30] },
        { nodeId: 'S1', name: '合成仓一', role: 'DC', coordinate: [115.2, 30], capacityByPeriod: { '2026-01': 1000, '2026-02': 1000 } },
        { nodeId: 'S2', name: '合成仓二', role: 'DC', coordinate: [115.5, 30], capacityByPeriod: { '2026-01': 1000, '2026-02': 1000 } },
        { nodeId: 'C', name: '合成客户C', role: 'CUSTOMER', coordinate: [115.6, 30], address: '测试用虚构地址' }
      ],
      periodDemand: PERIODS.map(period => ({ demandId: 'D1', customerNodeId: 'C', currentSiteId: 'S1', period, quantity: 10, unit: 'm3' })),
      observedInbound: PERIODS.map(period => ({ flowId: 'IN1', fromNodeId: 'F', toNodeId: 'S1', period, quantity: 10, unit: 'm3' })),
      distanceRows: [
        { fromNodeId: 'F', toNodeId: 'S1', distanceKm: 1, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 60 },
        { fromNodeId: 'F', toNodeId: 'S2', distanceKm: 1, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 60 },
        { fromNodeId: 'S1', toNodeId: 'C', distanceKm: 5, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 300 },
        { fromNodeId: 'S2', toNodeId: 'C', distanceKm: 6, unit: 'km', quality: 'VERIFIED_ROAD', source: 'SYNTHETIC_TEST_NOT_REAL_ROAD', strategy: 'TEST', travelSeconds: 360 }
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

  // 用例 (1)(2)：legacy OUTBOUND 快照（Report.createSnapshot 产物）
  function buildLegacy() {
    const Design = root.STCTPlatformV19.supplyChainDesign;
    const Report = root.STCTPlatformV19.supplyChainReport;
    const study = Design.createStudy(rawStudy('SYNTHETIC-F02-LEGACY', 'F02 合成 legacy 研究'));
    const baseline = Design.evaluatePortfolio(study, { type: 'OBSERVED_BASELINE', distanceBasis: BASIS });
    const common = { type: 'NETWORK_CANDIDATE', objective: 'COST', objectiveScope: 'TWO_END', facilityCounts: [1, 2], distanceBasis: BASIS, oneTimeConversionCost: 0 };
    const cand = Design.evaluatePortfolio(study, {
      ...common, scenarioId: 'F02-CAND', selectedSiteIds: ['S2'],
      sourcePlan: [{ sourceNodeId: 'F', siteNodeId: 'S2', share: 1 }]
    }, [{ demandId: 'D1', siteNodeId: 'S2' }]);
    const snapshot = Report.createSnapshot(study, baseline, [cand], [], common);
    return { study, snapshot };
  }

  // 用例 (3)：联合/V5 快照（V5.createSnapshot + fromVerified 产物，能通过 V5.assertCurrent）
  function buildV5() {
    const Design = root.STCTPlatformV19.supplyChainDesign;
    const Joint = root.STCTPlatformV19.supplyChainJoint;
    const V5 = root.STCTPlatformV19.supplyChainV5Results;
    const study = Design.createStudy(rawStudy('SYNTHETIC-F02-V5', 'F02 合成联合研究'));
    const baseline = Design.evaluatePortfolio(study, { type: 'OBSERVED_BASELINE', distanceBasis: BASIS });
    const scenario = {
      scenarioId: 'F02-JOINT', type: 'NETWORK_CANDIDATE', analysisScope: 'FULL_CHAIN',
      objective: 'VOLUME_KM', distanceBasis: BASIS, oneTimeConversionCost: 0,
      homogeneousDemandConfirmed: true, capacityPolicy: 'UNBOUNDED_SCREENING',
      allowAllSupplierSiteEdgesConfirmed: true, facilityCounts: [2]
    };
    const request = Joint.buildRequest(study, scenario);
    const referenceRequest = Joint.buildRequest(study, scenario, { reference: true });
    // 最小"已验证求解行"向量（合成独立测试向量，非求解器输出）
    const solverRow = siteId => ({
      status: 'OPTIMAL', facilityCount: 1, selectedSiteIds: [siteId],
      assignments: [{ demandId: 'D1', siteId }],
      sourceFlows: PERIODS.map(period => ({ supplierId: 'F', siteId, period, quantity: 10 })),
      objectiveValue: 1, verifiedObjectiveValue: 1, bestBound: 1, relativeGap: 0,
      objectiveRoundingBound: 0.001, quantityPrecision: 0.0001, quantityScale: 10000,
      coefficientPrecision: 0.001, solveTimeMs: 5, timeLimitSeconds: 10,
      variableCount: 8, constraintCount: 8
    });
    const refRow=V5.fromVerified(study,scenario,referenceRequest,solverRow('S1'),0);
    const candRow=V5.fromVerified(study,scenario,request,solverRow('S2'),1);
    const snapshot = V5.createSnapshot(study, baseline, scenario, refRow, [candRow], [], request, null);
    return { study, snapshot };
  }

  const structured = error => Boolean(error) && !(error instanceof TypeError)
    && Boolean(error.code || /STALE|UNSUPPORTED/i.test(String(error.message || '')));

  root.__tests.push({
    id: 'F02',
    title: 'buildModel 按快照 schema 分派：legacy 出模型、未知 schema 结构化拒绝、V5 走 V5 assertCurrent',
    run: async () => {
      const Design = root.STCTPlatformV19.supplyChainDesign;
      const ReportView = root.STCTPlatformV19.supplyChainReportView;
      const V5 = root.STCTPlatformV19.supplyChainV5Results;

      // ---- 用例 (1)：合法 legacy 快照 → buildModel 成功返回 model ----
      const legacy = buildLegacy();
      let model1 = null, error1 = null;
      try { model1 = ReportView.buildModel({ study: legacy.study, snapshot: legacy.snapshot }); }
      catch (error) { error1 = error; }

      // ---- 用例 (2)：未知 schema → REPORT_SNAPSHOT_SCHEMA_UNSUPPORTED（不得 TypeError / selectedSiteIds 错误）----
      // 浅克隆改 schemaVersion（快照已冻结不可改写）；未知 schema 下 assertCurrent 不会被调用，studyHash 任意。
      const unknownSnapshot = Object.assign({}, legacy.snapshot, { schemaVersion: 'stct-unknown-v0' });
      let model2 = null, error2 = null;
      try { model2 = ReportView.buildModel({ study: legacy.study, snapshot: unknownSnapshot }); }
      catch (error) { error2 = error; }

      // ---- 用例 (3)：联合/V5 快照（身份一致）→ 不抛 selectedSiteIds TypeError，返回 model 或结构化错误 ----
      const v5 = buildV5();
      let v5AssertError = null;
      try { V5.assertCurrent(v5.study, v5.snapshot); } catch (error) { v5AssertError = error; }
      let model3 = null, error3 = null;
      try { model3 = ReportView.buildModel({ study: v5.study, snapshot: v5.snapshot }); }
      catch (error) { error3 = error; }

      // ---- 用例 (3b)：V5 schema + 研究身份不一致 → 必须走 supplyChainV5Results.assertCurrent 的结构化拒绝 ----
      const otherStudy = Design.createStudy(rawStudy('SYNTHETIC-F02-V5-OTHER', 'F02 合成联合研究（身份不一致）'));
      let model3b = null, error3b = null;
      try { model3b = ReportView.buildModel({ study: otherStudy, snapshot: v5.snapshot }); }
      catch (error) { error3b = error; }

      const ok1 = Boolean(model1) && !error1;
      const ok2 = Boolean(error2) && error2.code === 'REPORT_SNAPSHOT_SCHEMA_UNSUPPORTED' && !(error2 instanceof TypeError) && !model2;
      const ok3 = !v5AssertError && Boolean(model3) && !error3;
      const ok3b = Boolean(error3b) && !model3b && !(error3b instanceof TypeError)
        && /STALE|UNSUPPORTED/i.test(String(error3b.code || error3b.message || ''));

      const pass = ok1 && ok2 && ok3 && ok3b;

      return {
        pass,
        expected: "(1) legacy 快照（stct-supply-chain-snapshot-v1.9）buildModel 返回 model；(2) schemaVersion='stct-unknown-v0' 时抛 {code:'REPORT_SNAPSHOT_SCHEMA_UNSUPPORTED'}，不得 TypeError/selectedSiteIds 错误；(3) V5 快照（stct-supply-chain-v5-snapshot-v1）通过 supplyChainV5Results.assertCurrent，buildModel 不抛 selectedSiteIds TypeError，返回 model 或明确结构化错误；(3b) V5 schema 与研究身份不一致时由 V5 assertCurrent 结构化拒绝（SUPPLY_SNAPSHOT_STALE 等），不得原始 TypeError。",
        actual: {
          legacy: { returnedModel: Boolean(model1), error: error1 ? (error1.code || error1.message) : null },
          unknownSchema: { returnedModel: Boolean(model2), errorCode: error2 ? (error2.code ?? null) : null, errorName: error2 ? error2.name : null, message: error2 ? error2.message : null },
          v5: {
            assertCurrent: v5AssertError ? (v5AssertError.code || v5AssertError.message) : 'OK',
            returnedModel: Boolean(model3),
            error: error3 ? (error3.code || error3.message) : null,
            errorIsTypeError: error3 instanceof TypeError
          },
          v5IdentityMismatch: {
            returnedModel: Boolean(model3b),
            errorCode: error3b ? (error3b.code ?? null) : null,
            errorName: error3b ? error3b.name : null,
            message: error3b ? error3b.message : null
          }
        }
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
