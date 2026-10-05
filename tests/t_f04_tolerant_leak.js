(function (root) {
  'use strict';
  root.__tests = root.__tests || [];

  /* F04 导入隔离：宽容解析状态（模块级 tolerantSink）不得泄漏到后续严格导入。
   * 向量：先 tolerant 解析“1月10/2月bad/3月30”行，再 strict 解析含非法静态节点坐标的映射。
   * 只通过公开 API supplyChainImport.applyProfile 的返回值/抛出错误断言。 */

  const SCHEMA = 'stct-supply-chain-import-v1.9';

  function badRowFixture() {
    return {
      workbook: {
        schemaVersion: SCHEMA,
        fileName: 'fixture.csv',
        format: 'CSV',
        sheets: [{
          name: 'd',
          rowCount: 2,
          columnCount: 4,
          merges: [],
          rows: [
            { rowNumber: 1, values: ['demandId', '2026-01', '2026-02', '2026-03'] },
            { rowNumber: 2, values: ['D1', 10, 'bad', 30] }
          ]
        }]
      },
      profile: {
        profileId: 't',
        staticNodes: [{ nodeId: 'W', role: 'DC', name: 'Warehouse' }],
        blocks: [{
          kind: 'PERIOD_DEMAND',
          sheet: 'd',
          startRow: 2,
          endRow: 2,
          fields: { demandId: 1, currentSiteId: { constant: 'W' } },
          periodColumns: [
            { period: '2026-01', column: 2, measure: 'quantity', unit: 'm3' },
            { period: '2026-02', column: 3, measure: 'quantity', unit: 'm3' },
            { period: '2026-03', column: 4, measure: 'quantity', unit: 'm3' }
          ]
        }]
      }
    };
  }

  function strictStaticFixture() {
    return {
      workbook: {
        schemaVersion: SCHEMA,
        fileName: 'strict.csv',
        format: 'CSV',
        sheets: [{
          name: 'd',
          rowCount: 2,
          columnCount: 2,
          merges: [],
          rows: [
            { rowNumber: 1, values: ['demandId', '2026-01'] },
            { rowNumber: 2, values: ['D2', 5] }
          ]
        }]
      },
      profile: {
        profileId: 's',
        staticNodes: [{ nodeId: 'W2', role: 'DC', name: 'Warehouse2', coordinate: [200, 30] }],
        blocks: [{
          kind: 'PERIOD_DEMAND',
          sheet: 'd',
          startRow: 2,
          endRow: 2,
          fields: { demandId: 1, currentSiteId: { constant: 'W2' } },
          periodColumns: [{ period: '2026-01', column: 2, measure: 'quantity', unit: 'm3' }]
        }]
      }
    };
  }

  root.__tests.push({
    id: 'F04',
    title: '宽容解析状态不得泄漏到后续严格导入（错误码/排除清单隔离）',
    run: async () => {
      const Import = root.STCTPlatformV19.supplyChainImport;

      // 第一次调用：tolerant，制造模块级 tolerantSink 并返回排除清单
      const bad = badRowFixture();
      const first = Import.applyProfile(bad.workbook, bad.profile, { tolerant: true });
      const excludedBefore = JSON.stringify(first.excludedRows);

      // 第二次调用：strict，静态节点坐标非法（应抛 SC_IMPORT_COORDINATE_INVALID）
      const strict = strictStaticFixture();
      let strictError = null;
      try {
        Import.applyProfile(strict.workbook, strict.profile, {});
      } catch (error) {
        strictError = error;
      }
      const excludedAfter = JSON.stringify(first.excludedRows);

      const codeIsolated = Boolean(strictError) && strictError.code === 'SC_IMPORT_COORDINATE_INVALID';
      const listUntouched = excludedBefore === excludedAfter;
      const firstHadExclusion = first.excludedRows.length >= 1;
      const pass = firstHadExclusion && codeIsolated && listUntouched;

      return {
        pass,
        expected: '连续调用不串状态：tolerant 调用之后的 strict 调用遇到非法静态节点坐标必须抛 SC_IMPORT_COORDINATE_INVALID（不得出现 ROW_SKIPPED 泄漏），且第一次调用返回的 excludedRows 不被后续调用追加污染。',
        actual: {
          firstExcludedRows: JSON.parse(excludedAfter),
          firstExcludedRowsUnchanged: listUntouched,
          strictErrorCode: strictError ? strictError.code : null
        }
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
