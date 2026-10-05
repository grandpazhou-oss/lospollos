# STCT UI 与地图交互候选 · 2026-10-04

本轮是可体验的第一版，优先完成供应链结果页与地图交互。Windows W0–W4 收口按用户要求暂停；没有把 Windows 补丁合入此候选。

## 打开

http://127.0.0.1:9980/index.html?optPort=9982#/design/supply-chain-study

当前 web / optimizer 服务都已检查返回 HTTP 200，仅监听本地。进入后使用原有演示登录（demo / demo123，这是 Mock Login，不是安全认证）。隔离浏览器库已从情景库的正式导入控件回读合法全链研究副本。

候选根目录：`/Users/gz/Documents/lospollos-ui-map-20261004_004327`
保护的原版本：`/Users/gz/Documents/lospollos-enterprise-closure-20261003_161313`

停止或重启仅操作本候选的实例：

```sh
cd /Users/gz/Documents/lospollos-ui-map-20261004_004327
python3 scripts/local_trial.py stop
python3 scripts/local_trial.py start --web-port 9980 --opt-port 9982
```

重启前端口须空闲，启动器会检查；不停止其他项目服务。Windows 可复用现有启动器与业务代码，但本轮未在 Windows 实机验证，也未重做 OSRM 收口。

## 本轮变化

- 首页任务上移，去掉大块垂直空白。统一深蓝导航、蓝色操作、浅色工作区与可读的表单层次。
- 供应链页缩短标题和步骤区；当前候选、视图、运输段保持直接可用，期间/变化/节点放在“细化查看”中。存在过滤条件时自动展开，避免隐藏筛选。
- 距离卡片明确展示原值→新值及增减百分比。绿色/棕色只表示距离减小/增大，不代表盈利/亏损。原始数值与账本未修改。
- 地图初始不展开全部对象。对象列表在搜索或展开时出现；分屏和扩大地图时仍可搜索，唯一匹配对象可按 Enter 定位。
- 保留原/新双地图及同步视野、稳定仓库颜色、图层、无 WebGL 示意图和原始明细。
- 右侧按“节点 → 关系类别 → 单条关系”逐层展开。原/新物量分栏，变化数量、距离和服务仓在同张关系卡中显示；编号保留在悬停提示和明细。
- 长清单每次增加 6 条，所有关系仍可到达。Esc 从关系详情返回清单。关闭详情会解除节点聚焦；切换仓库或打开新关系时恢复面板顶端。
- 中等宽度双地图上下排列，详情放在地图下方；窄屏沿用可收起、可关闭的底部面板。

## 验证

证据目录：`/Users/gz/Documents/New project/.stct-ui-map-20261004_004327`

1. 最终源码检查：2 个 JavaScript 语法检查 + 6 个现有回归脚本，8/8 命令 exit 0。含三范围地图投影、过期保护、数量与费用未知值、仓库颜色稳定性、COMMAND 模拟位置标记、研究切换视图桥接。
2. 浏览器：通过正式首页/情景库导入、导航、地图、搜索、分页和设置控件完成 32 条断言（含最终复验）。没有注入研究状态。覆盖双图、关系七个月明细、关闭恢复、筛选、候选身份、zh/en/ja、No-WebGL、减少动态效果、906px 与 480px 布局、COMMAND 返回和刷新回读。
3. 包模块回环：使用本候选原生 controller 导入→导出全链包，study / snapshot 内容逐字一致，inputHash、snapshotHash、packageHash 均保持相同。这是独立模块验证，不冒充浏览器文件下载成功。
4. 保护核查：原版本 590 个基线文件哈希无变化。候选仅改动下表 4 个既有文件；求解器、计算、独立校验、导入模型、研究保存、报告引擎与原始资料未改。
5. 前端入口字节与当前 index.html 一致；优化器健康端点 200。没有新增依赖、commit、push、deploy，也没有修改受保护端口。

已执行命令和退出码见 MODULE_TESTS.json / module-*.log；界面证据见 BROWSER_TESTS.json；前后源文件哈希和差异见 FINAL_SOURCE.json / SOURCE_CHANGES.json / CHANGES.diff。

## 边界与未执行

- 这轮是 UI 候选，未全面改版 COMMAND，不新增模型，不重新产生业务求解结果。
- Windows / OSRM 实机：NOT_RUN，按用户决定暂缓。真人体验：NOT_RUN。正式 v1.8 Soak：DEFERRED_BY_USER。
- 精确 390 CSS px：NOT_RUN。现有浏览器 50% 缩放与最小视口把请求限制到 480 CSS px，记录的是实际 480，不能写成 390。
- 系统打印：NOT_RUN。本轮保留打印样式，未以静态检查代替实际打印。
- 浏览器研究包取件：BLOCKED。正式“下载可回读研究包”按钮的 download 事件在 20 秒内未返回，未获取落盘文件，因此未声称浏览器下载回读通过。“保存研究包”按钮实际是本机保存，已显示本机保存成功；这一旧文案仍可进一步改进。
- 切换旧地图实例时记录到两个 MapLibre 请求取消日志；底图及业务图形随后恢复可见。本轮未修改 vendor，也未把这类日志记为零错误。
- 所用全链副本仅供本地 UI 核查；其 OSRM 来源元数据仍属于暂停中的 Windows 独立收口范围，地图界面升级不提升道路证据等级。

## 文件处置

| 文件 | 处置 | 内容 |
| --- | --- | --- |
| index.html | KEEP / 保留 | 候选版本标记、3 个资产缓存版本 |
| platform-workbench-v85.css | KEEP / 保留 | 标题/步骤/筛选/卡片与响应式布局 |
| platform-map-runtime-v19.js | KEEP / 保留 | 分批关系、搜索键盘、聚焦解除和详情位置恢复 |
| supply-chain-view-v19.js | KEEP / 保留 | 筛选折叠和距离变化展示 |
| UI_MAP_READOUT.md | KEEP / 保留 | 入口与验收交接 |
| 外部证据目录 | OTHER_ACTION / 其他处理 | 留作本地审查；不作为应用业务数据 |

REVERT：无。失败的下载取件未改动业务源码或原始资料。候选为独立副本，原工作树没有被覆盖。
