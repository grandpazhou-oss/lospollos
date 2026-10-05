# STCT 修复批次1 · 红灯测试（repros）

为问题台账 F03/F04/F05/F06/F07/F12 固化的最小复现测试。每个测试先复现缺陷语义
（红），修复落地后转绿。向量来自独立审查包 `evidence/repros/*.json` 及其生成脚本
（`scripts_as_executed/cost_review.js` 等），全部为合成数据，不冒充原生求解。

## 运行方法

1. 浏览器直接打开 `lospollos/tests/run_repros.html`（双击即可，或经任意静态服务访问）。
   页面按依赖顺序 `<script>` 加载被测 UMD 模块与测试文件，加载完成后自动执行一次。
2. 自动化注入：调用 `window.__runAll()`（返回汇总对象），或点击页面“运行全部”按钮；
   汇总 JSON 同时写入 `window.__testResults`：
   `{ startedAt, finishedAt, total, passed, failed, results: [{ id, title, pass, expected, actual }] }`。
3. 结果表格每行四列：测试ID | 期望 | 实际 | PASS/FAIL。

## 测试与台账对照

| 测试文件 | 台账 | 复现向量 | 断言（期望） | 红基线（缺陷行为） |
|---|---|---|---|---|
| `t_f03_tolerant_atomic.js` | F03 导入保真 | `repros/tolerant_partial_row.json` 输入结构（1月10/2月bad/3月30 宽表行） | tolerant 导入整行原子：该行进排除清单，periodDemand 无“2026-01=10”半截行，派生客户节点/归属无残留 | 逐格处理：已留 1月10 与 CUSTOMER:D1，3月丢失，同时又标排除 |
| `t_f04_tolerant_leak.js` | F04 导入隔离 | 先 tolerant 解析坏行，再 strict 解析含非法静态节点坐标的映射 | strict 抛 `SC_IMPORT_COORDINATE_INVALID`（非 ROW_SKIPPED）；前次返回的 excludedRows 不被后续调用污染 | 模块级 tolerantSink 泄漏 → ROW_SKIPPED 且污染前次排除清单 |
| `t_f06_open_version_race.js` | F06 研究身份 | `repros/open_version_race.json`（期望 B-NEW，实际 A-OLD） | openVersion('A') 迟到响应不得覆盖 B；最终 state.study=STUDY-B | A 的 pointer 读取返回后覆盖当前研究为 A-OLD |
| `t_f07_delete_save_race.js` | F07 保存/删除 | `repros/delete_save_race.json`（删除读 rev1，并发保存 rev2） | 删除按 expectedRevision=rev1 CAS：冲突返回 REVISION_CONFLICT，rev2 指针与 payload 原样保留 | 无 CAS：旧删除删掉 rev2 指针（remainingPointer=null，新 payload 孤立） |
| `t_f12_report_assert.js` | F12 快照可信 | 新 study.inputHash + 旧 snapshot（studyHash 不匹配） | buildModel 抛快照不一致/过期错误（如 SUPPLY_SNAPSHOT_STALE），不得出报告 | 新入口绕过 assertCurrent，直接产出报告 |
| `t_f05_closure_cost.js` | F05 费用结论 | `repros/closure_cost.json` 合成费用（cost_review.js 管线：320→1140/2 期） | 关仓判定反映相对焦点方案每期 +410（运输+10、处理费+500、固定−100），不得显示“净省 90 / 已划算” | 只算运输−固定（10−100）→ 显示“已划算（净省 90/期）”，漏算处理费 |

## 当前红/绿状态

本套件是红灯测试：六个测试在修复批次1 落地前均为 FAIL（红）。修复批次1 在测试
编写期间并发落盘（import 16:32、controller 16:41、report-view 16:52→17:12→17:23，
2026-09-30），最终观察（2026-09-30 17:28）六项全部转绿：

| 测试 | 红基线（修复前） | 当前（修复后） | 说明 |
|---|---|---|---|
| F03 | FAIL：半截行“2026-01=10”+ CUSTOMER:D1 残留 | PASS（绿） | 整行原子提交已落地 |
| F04 | FAIL：strict 抛 ROW_SKIPPED 且污染前次排除清单 | PASS（绿） | 解析上下文已局部化 |
| F06 | FAIL：state 被迟到的 A-OLD 覆盖 | PASS（绿） | 迟到响应被 `SUPPLY_RUN_OBSOLETE` 拒绝，最终 state 为 B |
| F07 | FAIL：旧删除删掉 rev2 指针（剩余指针=null） | PASS（绿） | 删除经 expectedRevision CAS 墓碑提交，冲突返回 REVISION_CONFLICT，rev2 完好 |
| F12 | FAIL：不校验直接出报告 | PASS（绿） | buildModel 统一 assertCurrent，抛 SUPPLY_SNAPSHOT_STALE |
| F05 | FAIL：显示“已划算（净省 90/期）”（17:20 时点仍红） | PASS（绿） | 判定显示“未划算（相对推荐方案全费用净增 410/期：运输 10、处理 500、固定 −100）” |

红基线验证：对树快照逐一重新引入六个缺陷（变异验证）后，对应测试逐一转红且互不
干扰；随后恢复修复代码全部转绿——每个测试对本台账缺陷敏感，先红后绿。

## 设计约束

- **独立验证器**：断言只看公开 API 输出/状态（`applyProfile` 返回值、controller 的
  `viewState()/save()/deleteStudy()` 结果、仓储公开 `read()` 回读、`buildModel/render`
  输出）；不引用被测模块内部函数做断言辅助。
- **合成仓储 stub**：`tests/helpers_memrepo.js`（内存实现 `platformRepository` 公开
  接口，不依赖 IndexedDB）。测试控制：`__gateRead({store,id})`（挂起下一次匹配读取，
  `id:null`＝清单读取）、`__gateOp({store,skip})`（挂起第 skip+1 次仓储操作，制造
  读取—提交竞态窗口）、`__seed(store,rows)`。`removeMany(entries,auditEntry,expected)`
  第三参为可选 CAS 期望版本：传入时版本不符抛 `REVISION_CONFLICT` 且不删除（模拟
  “同一事务读取并比较 expectedRevision”）；不传则为无条件删除（复现 F07 缺陷）。
- **向量仅复现**：F05/F12 夹具经公开管线（`createStudy` → `evaluatePortfolio` →
  `Report.createSnapshot`）构造真实快照，费用数据来自审查包合成向量；
  竞态测试用门闸控制时序，不依赖被测实现的内部步骤顺序。
