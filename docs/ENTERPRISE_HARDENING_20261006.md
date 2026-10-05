# 企业加固第一批：保存、版本准入与道路复用

状态：**待完整回归的独立修复分支，不是企业化全部完成或生产上线。**

基线：`a37e2ea813219fd506636e6521e9e45d56823ec0`，来自
`codex/windows-handoff-map-showcase-20261005`。
修复分支：`codex/enterprise-hardening-20261006`。

## 本批修改

### A. 同 ID 导入不再自动接管已有研究

`save()` 捕获本次保存对应的编辑绑定与版本，不再读取到已有 ID 后自动采用最新 revision。
未绑定存档的导入（包括完全相同的草稿）、不同内容的草稿或完整研究包，遇到已有 ID 均返回
`REVISION_CONFLICT`。已删除研究不能被导入复活；正常 reopen 后编辑继续使用原有 CAS。
保存期间切换研究或改变编辑绑定会返回 `SUPPLY_SAVE_OBSOLETE`。

不删除原研究、历史内容或目录指针。遇到冲突，应打开现有研究继续编辑；创建独立副本需要新研究 ID。
本批未增加 Save As/显式替换 UI，也不通过删除旧数据解决冲突。

### B1. 严格构建准入

默认 `optimizerBuildPolicy: 'STRICT_PINNED'`：缺失或不合法的预期指纹返回
`EXPECTED_BUILD_FINGERPRINT_REQUIRED`；不匹配返回 `BUILD_FINGERPRINT_MISMATCH`。
这些情况的 `available` 与 `jobsV6` 都为 false，`run()` 不提交求解请求。

只允许开发者显式选择 `COMPATIBLE_WARN`；其差异会保留在返回结果与 backendIdentity 中。
没有 pin 不再被标记为 buildMatch。兼容模式仍检查端点、依赖、模型、协议和所需能力。
不应为绕过试点版本检查而切换到兼容模式。

原后端和配置中的预期指纹未改变。**五文件指纹仍是窄范围内容身份，不是完整 manifest、
数字签名、身份认证或供应链安全证明。** 将 worker/共享契约纳入统一 manifest 属于未完成 B2。
其他测试的合成后端需要明确给出对应测试 pin，或显式声明测试兼容策略；不要降低正式配置。

### E1. 跨研究道路复用检查来源

`reuseAssessment()` 对本地 OSRM 生成的估算道路记录进行检查：有方向的请求坐标、坐标系、
路网版本、driving profile、端点、生成时间、距离/时间、吸附证据及原有模型假设必须匹配。
`latestRoadDistancesFor()` 只有在这些条件通过时才返回可复用记录。

本地默认复用有效期是 30 天，可用 `roadReuseMaxAgeMs` 调整；这是项目策略，不是道路、交通或
货车限制真实性保证。未声明路网版本、证据不完整、过期或来源不同的历史记录不自动复用，
需要重算或走明确的人工导入流程。当前只支持 `driving`；请求不支持的 profile 会明确失败。
保持 `ESTIMATED_ROAD`、`truckRestrictions: NOT_VERIFIED`、`traffic: NOT_MODELED`，不提升证据等级。

本批不对同一研究中已经存在的所有道路记录做追溯失效，也不替代完整报告口径和车辆道路验证。

## 已执行验证及局限

| 检查 | 本次结果 | 范围 |
| --- | --- | --- |
| 36 项定向 Node 单元回归 | PASS，0 失败、0 跳过 | 完整真实 controller/road 文件；领域、HTTP、内存仓储为合成协作者 |
| 对旧基线执行 8 项保存/准入回归 | 8 项均按预期失败 | 证明这些断言能暴露旧行为，而非仅在新版本显示绿色 |
| 修改后的 JavaScript / Python 语法 | PASS | 不等于运行环境验收 |
| Chromium / 原生 IndexedDB 组件验收 | BLOCKED_ENVIRONMENT | 页面导航被运行环境以 ERR_BLOCKED_BY_ADMINISTRATOR 拒绝；没有执行原生存储断言 |
| 全应用浏览器、既有全量测试 | NOT_RUN | 未取得完整运行工作树及依赖环境 |
| 原生 OR-Tools、真实 OSRM、Windows 实机 | NOT_RUN | 此环境不具备相应验收条件 |

Node 测试加载完整生产 controller 源码，不是复制一个修复表达式；但其领域/报告验证器和仓储是
合成替身。测试夹具中的 canonical 文本只用于测试 ID，不是生产哈希或真实求解器。
浏览器脚本使用真实 repository 与 IndexedDB，并保持合成领域协作者；即使它通过也不是全应用验收。

测试命令（先使用已批准的现有环境，不自动安装依赖）：

```sh
node --test tests/test_enterprise_hardening_v1.cjs
python3 tests/test_enterprise_hardening_browser.py --evidence-dir ../lospollos-hardening-evidence
```

浏览器脚本要求 Python Playwright 与已存在的 Chromium，可用 `STCT_CHROMIUM` 指定可执行文件。
只使用操作系统分配的 loopback 临时端口和独立随机测试数据库，不读取用户浏览器档案。
证据目录必须位于仓库外。环境阻断、依赖缺失不算 PASS；不得绕过环境策略。

## 合并前仍需完成

完整 manifest（B2）、新旧求解入口统一资源准入（C）、耐久作业与刷新/重启恢复（D）、完整报告
业务口径验收（E2）、发布准入和真人/Windows 验收（F）尚未实现或完成。
共享部署的企业身份、服务端授权、备份、审计和任务所有权也不在本批交付中。
公开仓库内部资料分类、公开授权核实及必要的历史清理由维护者单独处理；本批不改变可见性、
删除资料、改写 Git 历史或修改分支保护。

本批未修改任何 Python 求解器、目标函数、数量标度、校验容差或求解依赖。
未更换 UI 框架、部署服务、占用受保护端口或启动延期的 soak。

## 集成与回退

先在隔离工作目录检查本分支、完成全量适用回归，再审查合并到上述活动开发分支；不要自动合并到
仍旧的 main，不要切换正在运行的服务。未合并前原开发分支保持原样。
如需回退已集成的变更，使用正常 revert 流程；不使用 force push，也不删除浏览器研究数据。
