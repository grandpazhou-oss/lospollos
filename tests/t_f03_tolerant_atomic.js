(function (root) {
  'use strict';
  root.__tests = root.__tests || [];

  /* F03 导入保真：宽容跳过行必须是原子操作。
   * 向量来源：审查包 evidence/repros/tolerant_partial_row.json 的输入结构
   * （宽表行 D1 = 1月10 / 2月bad / 3月30，静态节点 W）。
   * 只通过公开 API supplyChainImport.applyProfile 的返回值断言。 */

  const SCHEMA = 'stct-supply-chain-import-v1.9';
  const ROW_ID = '0:d:2';

  function fixture() {
    const workbook = {
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
    };
    const profile = {
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
    };
    return { workbook, profile };
  }

  const fromRow = (records, rowId) => (records || []).filter(row => {
    const sources = Array.isArray(row.sources) && row.sources.length ? row.sources : (row.source ? [row.source] : []);
    return sources.some(source => source && source.sourceRowId === rowId);
  });

  root.__tests.push({
    id: 'F03',
    title: '宽容导入的跳过行必须原子（整行全进或全不进）',
    run: async () => {
      const Import = root.STCTPlatformV19.supplyChainImport;
      const { workbook, profile } = fixture();
      const result = Import.applyProfile(workbook, profile, { tolerant: true });

      const excludedRows = result.excludedRows.filter(row => row.sourceRowId === ROW_ID);
      const halfDemand = fromRow(result.periodDemand, ROW_ID);
      const residualNodes = fromRow(result.nodes, ROW_ID);
      const residualAssignments = fromRow(result.observedAssignments, ROW_ID);

      const pass = excludedRows.length > 0
        && halfDemand.length === 0
        && residualNodes.length === 0
        && residualAssignments.length === 0;

      return {
        pass,
        expected: `行 ${ROW_ID}（1月10 / 2月bad / 3月30）在 tolerant 模式下整行原子处理：2月数量非法 → 整行排除（excludedRows 含该行），periodDemand 不得留下“2026-01=10”半截行，派生客户节点与归属记录同样不得残留（全进=3 期记录，全不进=0 期）。`,
        actual: {
          excludedRows,
          periodDemandFromRow: halfDemand.map(row => `${row.period}=${row.quantity}`),
          nodesFromRow: residualNodes.map(row => row.nodeId),
          assignmentsFromRow: residualAssignments.map(row => `${row.demandId}@${row.siteNodeId}`),
          summary: result.summary
        }
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
