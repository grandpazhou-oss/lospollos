# 可信供应链报告工作区 v0.1 · 移交记录

本轮在独立工作树和功能分支完成。原 `/Users/gz/Documents/lospollos` 的未提交文件、冻结移交版和既有服务未被修改；未 push、合并、部署或安装依赖。

## 版本与入口

- 基线：`7911a8e4cc28b58bde6241f49fa695d1f11cf2b7`，`codex/enterprise-validation-20261006`。PR #1/#2 当时均为 Draft，按实际包含加固成果的 PR #2 基线创建工作树。
- 分支：`codex/trusted-report-workspace-20261007`。
- 工作树：`/Users/gz/Documents/New project/lospollos-trusted-report-20261007`。
- 第一份实现提交：`35db18b`。最终 SHA、源码与日志哈希以外部验收目录 `SOURCE_FREEZE.json` 为准，避免文档自引用哈希。
- 本轮隔离入口：`http://127.0.0.1:19465/index.html?optPort=19467#/`。服务状态、精确 PID 和重启方法见外部 `00_READOUT.md`；不切换旧入口。

操作：主页 → 数据中心 → 上传合成 Excel 并确认映射 → 确认分析条件 → 开始分析 → 第 3 步的“交互式结论报告（验证期）”。已有完整研究也可从公共情景目录重开。报告先显示结论、再比较、最后证据；点击数字/状态或键盘 Enter 打开明细，再点“在 Univer 只读工作簿中审阅”。

已保存的合成研究与截图在源码目录外：`/Users/gz/Documents/New project/STCT_可信报告验收_20261007`。最终浏览器目录包含 `synthetic-input.xlsx`、`full-chain-synthetic.package.json`、三范围原生 HTML/CSV/JSON/MD 和实际截图。它们不是客户资料；没有使用原 UC 文件。

## 数据与实现边界

既有导入 → `supply-chain-controller-v19` → 原生求解/独立校验 → 原快照 → `trustedReport.project` → 摘要、比较、证据。打开报告先执行既有 `assertCurrent`；排序沿用 `comparisonProjection`，结论沿用 `decisionText/businessBrief`。没有新增求解、排名、成本模型、持久化或结果字段。

摘要变化的前后值及比例使用快照中的共同可比样本，显示覆盖率；比较表另列各方案全量已知距离及其覆盖率。配送的观察现状、上游已知来源入库参照、全链同条件规划参照保持独立。未知费用仍为 null，确认零与不适用查费率状态；全局、站点和期间费率全部保留作用域，未按 kind 合并。输入原精度、约束、求解目标和 verifier 容差不变。

证据按候选 ID、指标和来源记录键定位，不依赖表格位置；每页最多 200 条。明细缺项明确不可用，不生成行级答案。假设按实际对象结构读取，保存的来源模式、总量模式和能力条件可追溯；无上限供应能力筛选明确为理论条件。缺失结果时间与来源显示未知，不用报告打开时间替代。

HTML/CSV/JSON/MD 按现有 controller 导出和校验路径生成；工作簿和明细没有独立写回入口。复制沿用原 CSV 的文本中和及字段引用规则，避免制表符/换行拆成可执行公式单元格。

## Univer 与许可

- 用户指定 SDK：`/Users/gz/Documents/Skills/univer`；实际 1.0.3、源码 `748661cbe4c4206c8e188fe0b18ea371a6909776`。它是前端 SDK checkout，不是安装后自动接入的 Codex 插件或独立服务。
- 使用该目录已有 esbuild、PostCSS/Tailwind、React 等依赖本地构建；没有安装、升级、运行新 hooks 或外部转换。重建命令：`node scripts/build_univer_report.mjs <已安装的 Univer 1.0.3 SDK 目录>`。
- SDK 源码身份、tracked 状态和实际解析源码字节摘要来自构建时读取，记录在 `vendor/univer/NOTICE`。87 个解析依赖的版本/许可声明及可用原文在 `THIRD_PARTY_LICENSES.txt`；Univer 为 Apache-2.0，无 Pro 服务注册。telemetry 只提供接口标识，未注册遥测实现。
- 编译后的 JS 约 12 MB，点工作簿时按需加载；CSS 同样延迟加载，通过原生 Shadow DOM 隔离旧全局样式。仅一份工作簿，关闭、切换指标/研究、失效或离开路由时释放实例及监听；迟到加载不能落入新报告。
- 实际调用 `setEditable(false)`，且 `BeforeCommandExecute` 拒绝全部 MUTATION；所有显示文本为 FORCE_STRING，无 `f`，初始公式计算关闭。公式模块是基础预设依赖，不用于业务重算。
- SDK 失败保留摘要、比较和可访问明细表。没有启用 XLSX、商业导出、云转换、Word/PPT 办公套件。Excel/Windows 原生剪贴板实机验证仍未执行。

## 既有线索与本轮修正

| 项目 | 本轮结论 |
|---|---|
| FULL_CHAIN 配置后未提交 job | 本轮合成条件经真实页面点击产生原生 job、独立核验并保存；旧 Windows 特定条件未复现，未宣称其已关闭 |
| 费率相同 kind | 不是唯一键；保留原作用域及优先级，核心费用回归通过，未去重 |
| 草稿与完整结果 | 草稿无报告；三范围完整保存→刷新→目录重开保持同一 snapshotHash |
| 过期与并发 | 原保护保留，改输入后报告禁用；冲突模块回归通过，本轮未另建并发机制 |
| 原审查中 4 个 Spec 问题 | 对象假设点击异常、共同样本错配、上游参照空明细、缺建模限制均已最小修正，失败复现与新增回归保留 |
| 原审查中 2 个 Standards 问题 | SDK 固定 SHA 声明改为实际身份；浏览器全部页面异常收集且非空即失败；限定复核未发现残留确认缺陷 |
| 大道路包导入、长时内存、Windows/CMD | 独立待验项不扩入本轮；既有失败及环境限制保持原状 |

## 验证方式与边界

最终命令、退出码、环境、测试矩阵、源码与证据哈希在外部 `TEST_MATRIX.csv`、`EXECUTION.json`、`SOURCE_FREEZE.json`，不把历史结果覆盖为新 PASS。

| 证据层 | 已执行内容 |
|---|---|
| 模块/确定性复算 | 新报告：6 候选/少候选/无候选/不可行混合、并列、缺排名、过期、未知/确认零费用及零基线、t/m³、估算道路、200 条分页、原值不可变、公式文本和复制字段安全 |
| 既有 core | 明确选定的 35 个命令，含 DESIGN、COMMAND 模块、草稿/冲突、CSV、安全校验、取消、道路来源和运行身份；不是全历史测试 |
| 既有 native | 12 个命令，实际 OR-Tools 9.15.6755；非 mock 或输入校验替代 |
| macOS 浏览器业务流程 | 已安装 Node Playwright + Chrome；首页公共上传/映射 → 三范围业务配置 → 原生求解 → 实际 DOM 排名/全部指标证据 → 可见 SDK 编辑/删除/粘贴/填充及结构快捷键尝试不改值、选择复制 → 4 种导出 → 保存/刷新/目录重开 |
| 浏览器组件夹具 | 6 个合法候选及公式文本、部分覆盖共同样本；经报告公共 API 渲染，明确不是原生业务求解或内部研究状态注入 |
| 浏览器异常层 | SDK 请求失败、迟到响应后关闭/离开、地图组件请求不可用、390px、3 轮有界进出；不是正式 Soak |
| 既有 Python browser 命令 | BLOCKED_ENVIRONMENT：当前 Python 无 playwright；两个指定脚本 NOT_RUN。Node 实际流程单列，不冒称该命令通过 |
| 人工/跨平台 | 真人观察、原生 Windows/Edge、系统打印、真实客户/道路资料 NOT_RUN；Windows Agent 保持暂停，v1.8 Soak DEFERRED_BY_USER |

基线受限 sandbox 的端口绑定失败、早期 SDK CSS/JSX/布局构建实验和测试器选择器/登录失败均保存在外部原始目录，按历史/实验分类，不计入最终 PASS。第三方生成 JS 的字符串与原许可文件保留上游空白；第一方 diff whitespace 检查单独运行，不改写第三方文本来掩盖检查。

## Skills 的实际使用

| Skill | 读取路径与作用 |
|---|---|
| domain-modeling | `~/.codex/skills/domain-modeling/SKILL.md`，统一 GLOSSARY 中真实现状、规划参照、重点候选、物量公里及费用状态；未做全仓术语改写 |
| diagnosing-bugs | `~/.codex/skills/diagnosing-bugs/SKILL.md`，复现真实工作簿零宽、旧样式污染及来源/样本审查问题后定位 |
| tdd | `~/.codex/skills/tdd/SKILL.md`，先保存失败检查，再最小实现和回归；未用 mock 冒充原生求解 |
| code-review | `~/.codex/skills/code-review/SKILL.md`，两个只读子代理分开检查 Standards/Spec；原报告与修正复核分轴保存，未自动发 Issue |
| Ponytail 4.13.0 full | `~/.codex/plugins/cache/ponytail/ponytail/4.13.0/skills/ponytail/SKILL.md`，复用现有 API、薄适配、原生样式隔离和分页；省去编辑器、第二套存储与计算 |

Matt Skills 本地文件未声明独立版本号，未编造版本；记录实际路径。缺少 issue-tracker 配置未触发安装/无关访谈，直接使用用户提供的本轮 spec。

## 逐文件处置

本轮代码与已验证增量均 KEEP，原工作树文件保持原样；没有撤销用户修改。

| 文件 | 处置 | 必要性 |
|---|---|---|
| `supply-chain-report-workspace-v01.js` | KEEP / 保留 | 同快照薄投影、摘要/排名/证据、按需工作簿及生命周期 |
| `supply-chain-report-workspace-v01.css` | KEEP / 保留 | 现有 token、宽表、窄屏、键盘和打印样式 |
| `supply-chain-report-view-v19.js` | KEEP / 保留 | 原报告入口委托；旧 API 保留 |
| `supply-chain-view-v19.js` | KEEP / 保留 | 原 controller 导出接入 |
| `supply-chain-report-v19.js` | KEEP / 保留 | 暴露现有 CSV 安全字段规则用于复制；原导出行为不变 |
| `index.html` | KEEP / 保留 | 注册报告 CSS/JS，SDK 不预加载 |
| `public-resources.json` | KEEP / 保留 | 允许隔离本地服务读取四个新增运行资源 |
| `config.js` | KEEP / 保留 | 按规定工具更新前端 optimizer pin |
| `optimizer/build-manifest.json` | KEEP / 保留 | allowlist 改动的实际运行指纹，非手工伪造 |
| `scripts/univer-report-entry.ts` | KEEP / 保留 | 本地 SDK 只读、Shadow DOM、实际选择复制及释放 |
| `scripts/build_univer_report.mjs` | KEEP / 保留 | 复用已安装依赖构建与实际来源/许可审计 |
| `vendor/univer/report.js` | KEEP / 保留 | 本地按需 SDK 运行资源 |
| `vendor/univer/report.css` | KEEP / 保留 | SDK 所需本地样式 |
| `vendor/univer/LICENSE` | KEEP / 保留 | 上游 Apache-2.0 许可 |
| `vendor/univer/NOTICE` | KEEP / 保留 | 真实 SDK commit、源码状态/摘要与未启用能力 |
| `vendor/univer/THIRD_PARTY_LICENSES.txt` | KEEP / 保留 | 87 个构建依赖的版本与许可信息 |
| `tests/test_trusted_report_workspace.js` | KEEP / 保留 | 可复用合法合成夹具及报告边界回归 |
| `tests/test_trusted_report_browser.js` | KEEP / 保留 | 真正业务控件与独立组件/故障层验收，异常不判 PASS |
| `GLOSSARY.md` | KEEP / 保留 | 本轮必要的业务术语约束 |
| `docs/TRUSTED_REPORT_WORKSPACE_20261007.md` | KEEP / 保留 | 当前移交记录 |
| 外部日志、截图、夹具、原失败记录和冻结清单 | OTHER_ACTION / 其他处理 | 作为可追溯证据保留在源码外；不提交、不混入客户数据 |
| 早期 Vite 全量 CSS 构建尝试 | REVERT / 撤销自己的实验 | 仅替换本轮未提交构建实验；两条已核对归属的卡住进程清理，原 SDK 未变 |

## 回退与下一步

停止本轮实例须使用对应外部 STCT_RUN_DIR 和 `python3 scripts/local_trial.py stop`，其归属核对不允许关闭其他实例。需要恢复旧报告时，在本轮功能分支按提交逆序 `git revert <本轮提交>`，或只停本轮预览并返回旧入口；不得 reset/clean 原工作树。

下一步最小验收：业务同事用合成包完成“重开→解释参照和限制→从两个候选查看同名指标→只读选择复制→保存回读/导出”；获准恢复 Windows 验证后，在独立 origin、浏览器档案和空闲端口重复这些操作，另记真实 Edge 与原生 CMD 的结果。本轮不自动继续 Windows、UC 或大包性能任务。
