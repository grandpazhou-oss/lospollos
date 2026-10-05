# Smart Transportation Control Tower v1.5.1 Integrity Closed

本仓库当前提供一个仅用于本地演示与验收的 Smart Transportation Control Tower（STCT）。它不是生产部署包，也不包含生产级身份认证、权限隔离、在线地图可用性承诺或企业数据接口。

## v1.5.1 完整性闭环

本版本完成 Pareto 指标完整性、九类审计身份 SHA-256、Derived Scenario Canonical authority、Scenario Capsule 深层校验、Recovery MatrixContext 真实性与 240-stop 性能门禁。Full Reoptimization 仍明确标记为 `ADAPTER_ONLY / NOT_INTEGRATED`，不会伪装成已接入 OR-Tools 的恢复能力。

240-stop 浏览器压力样本中，长任务由基线 54 次降至 1 次，应用更新约 19.85 Hz；RAF、应用更新、地图源更新和可见时间游标分别计数。详细验收结果见 [INTEGRITY_CLOSURE_V151.md](INTEGRITY_CLOSURE_V151.md)。

## 快速启动

不需要切换到项目目录；脚本会按自身位置定位文件：

```bash
bash /path/to/lospollos/start_demo.sh
```

默认地址：

```text
http://127.0.0.1:8765/index.html?optPort=8787
```

可选端口：

```bash
WEB_PORT=8865 OPT_PORT=8887 bash /path/to/lospollos/start_demo.sh
```

停止服务：

```bash
bash /path/to/lospollos/stop_demo.sh
```

脚本只会停止由本项目记录并核验过的 PID，不会结束占用同一端口的其他进程。运行记录与日志写入 `.run/`，也可通过 `STCT_RUN_DIR` 指向仓库外目录。

Windows 单机受控试用的独立启停入口与当前验收边界见 [README-WINDOWS-LOCAL-TRIAL.md](README-WINDOWS-LOCAL-TRIAL.md)。

## 优化引擎

页面始终可以独立启动。若本机 Python 已安装 OR-Tools，优化服务在 `OPT_PORT` 提供真实 OR-Tools 求解；否则页面明确降级为 `Demo Heuristic`，不会把演示算法标为 OR-Tools。

v1.4 使用 `shared/planning-contract-v13.json` 固定 Canonical Scenario、精度和约束。浏览器与 Python 对同一规范化字节计算 SHA-256，并区分 `contentHash`、`inputHash`、`requestHash`、`planHash` 与仅用于体验层的 `simulationHash`。服务端独立重算并拒绝伪造身份；前端 verifier 只用 Canonical Scenario 事实复算路线、容量、时间、成本、CO2、利用率与订单守恒。

服务目标按 `priorityWeight 总和 → assigned count → business objective` 排序。当前 OR-Tools RoutingModel 使用动态证明的 Big-M，上界、scale 与 int64 检查写入响应。六目标结果仍是配置时限内的 Best found，不声称全局最优。

日期模式明确分为：

- `SINGLE_DAY`：只允许一个配送日，可运行六目标、What-if 和人工调度。
- `MULTI_DAY_BATCH`：按日期生成独立 child scenario，每天重新使用当日车队；父级只做加权/峰值/累计汇总，不生成跨日路线。

本地依赖说明见 [optimizer/README.md](optimizer/README.md)。验收降级路径时可使用：

```bash
DISABLE_ORTOOLS=1 bash /path/to/lospollos/start_demo.sh
```

也可在本地页面 URL 加入 `?forceHeuristic=1`（已有查询参数时使用 `&forceHeuristic=1`）强制验证浏览器 fallback。页面会明确显示“测试模式：已强制使用 Demo Heuristic”，不会把该状态伪装为 optimizer ready。

`Demo Heuristic` 只用于离线演示和故障降级：它直接消费同一份 Canonical Scenario，并由同一 verifier 校验容量、时间窗、等待、班次、回场和订单守恒；但它不提供 OR-Tools 的搜索能力，不承诺最优解，复杂约束下可能保留未分配订单，不能替代生产排程决策。

## Mission Control Experience

生成并应用 verifier PASS 的方案后，可从左侧“演练”入口进入四个只读或事务化体验视图：

- Mission Control Replay：确定性运行回放、速度控制、车辆检查与模拟延迟；
- Scenario Arena：只比较 verifier PASS 的方案，支持叠加和桌面分屏；
- Dispatch Timeline + Constraint X-Ray：时间、容量、优先级与诊断透镜，并复用人工调度的预览、验证、提交和撤销事务；
- Demo Director：七幕演示并在退出时恢复进入前的业务选择与回放状态。

体验层不会修改 Canonical Scenario、候选方案身份或 verifier 结果。模拟延迟只写入临时 simulation log，不代表实时 GPS。无 WebGL 时提供表格/时间线等价路径，`prefers-reduced-motion` 下停用自动动画。

## 演示数据

- `templates/laiyifen-202605-rawdata.xlsx`：内部回归样本，不进入 clean dist。
- `templates/raw-dispatch-demo.xlsx`：通用原始数据样本。
- `templates/raw-dispatch-template.xlsx`：原始数据模板。
- `templates/smart-dispatch-demo.xlsx`：已整理的演示数据。
- `assets/demo/stct-synthetic-demo.json`：由固定 seed 生成的完全合成 v1.4 外发演示数据。

数据边界与外发检查见 [DATA_CLASSIFICATION.md](DATA_CLASSIFICATION.md)。

浏览器运行库 `vendor/maplibre/` 与 `vendor/xlsx/` 已固定在仓库内，避免本地 Demo 依赖公共 CDN；版本和来源见 `vendor/NOTICE.md`。地图样式与瓦片仍由 OpenFreeMap/OpenStreetMap 在线资源提供，断网、样式服务失败或浏览器不支持 WebGL 时，系统会保留非地图操作并显示明确提示。演示距离为球面直线距离乘以 `config.js` 中的 `roadDistanceFactor`（默认 1.35），不等同于真实导航道路里程。

供应链分析结果页现在在同一界面展示参照与候选的网络分配关系，可切换候选、期间、上游/配送段及叠加视图。线条是业务关联示意，不是道路路线；全链分析使用同条件规划参照。无 WebGL 时复用地图的 SVG 示意图和节点列表。公共 OSRM 道路预览默认关闭，只有在本地配置同时明确开启预览和坐标外发确认后才会请求公共服务；Windows 和 macOS 均沿用同一浏览器实现。

## 当前活动链路

当前页面只以以下文件为活动实现：

- `index.html`
- `style.css`
- `experience-v14.css`
- `config.js`
- `canonical.js`
- `data/routes-data.js`
- `validator.js`
- `optimizer.js`
- `verifier.js`
- `planning-v12.js`
- `main.js`
- `upload.js`
- `map.js`
- `render.js`
- `experience-v14.js`
- `replay-v14.js`
- `scenario-arena-v14.js`
- `timeline-v14.js`
- `demo-director-v14.js`
- `experience-ui-v14.js`
- `vendor/maplibre/maplibre-gl.js`
- `vendor/maplibre/maplibre-gl.css`
- `vendor/xlsx/xlsx.full.min.js`
- `optimizer/ortools_service.py`
- `optimizer/canonical_contract.py`
- `shared/planning-contract-v13.json`

## 本地验证

统一验收入口可从任意目录调用，并明确区分依赖语义：

```bash
./tests/run_all_v14.sh --mode static
./tests/run_all_v14.sh --mode release
./tests/run_all_v14.sh --mode fallback
STCT_BROWSER_EVIDENCE=/path/to/browser-evidence.json \
STCT_EXPERIENCE_PERFORMANCE_EVIDENCE=/path/to/performance-evidence.json \
  ./tests/run_all_v14.sh --mode browser
```

结果同时写入文本和 JSON，suite 状态只使用 `PASS`、`FAIL`、`SKIPPED_DEPENDENCY`、`BLOCKED_ENVIRONMENT`。`release` 要求 `ortools==9.15.6755` 且不允许跳过；`fallback` 强制验证 Demo Heuristic 完整链路并把 OR-Tools 专属套件标为依赖跳过。

单独运行核心套件：

```bash
node tests/test_canonical_v13.js
python3 -m unittest -v tests/test_canonical_v13.py
node tests/test_verifier_v13.js
python3 -m unittest -v tests/test_optimizer_v13.py
node tests/test_date_semantics_v13.js
node tests/test_priority_v13.js
node tests/test_manual_v13.js
```

## Clean distribution

本轮不执行远程部署。`netlify.toml` 只允许发布 `dist`，不会发布仓库根目录。白名单构建：

```bash
./scripts/build_demo_dist.sh
```

默认输出 `/tmp/lospollos-v1.4-clean-dist/` 和同名 ZIP。包内不包含 `.git`、测试、日志、客户原始工作簿或审计历史；内置 Demo 使用固定 seed 在构建时生成的完全合成 JSON。`SHA256SUMS.txt` 使用相对路径并排除自身，构建时会在原目录和随机解压目录各校验一次。Git HEAD 与当前工作树是不同的复现边界，本轮未自动 commit。

对指定 ZIP 执行随机解压后的 release 与 fallback 全链路冒烟：

```bash
STCT_BROWSER_NODE=/path/to/node STCT_NODE_PATH=/path/to/node_modules \
  ./tests/test_dist_runtime_v14.sh /path/to/lospollos-v1.4-demo-dist.zip
```

`dispatch.html`、`test_maplibre.html` 与 `backend/*` 是历史或诊断文件，当前入口不引用它们；本轮保留这些文件，仅用于追溯，不作为活动实现。

## 本地 Demo 边界

- 登录页是 Mock Login，仅控制本浏览器会话，不是安全认证。
- 数据留在本地浏览器和本机进程；请勿上传敏感或受监管数据。
- 当前没有生产级数据库、审计、备份、SLA、访问控制或真实导航路由服务。
- 发布到公司服务器前仍需完成安全、合规、基础设施和物理设备验收。


## V87 地图对照与隔离试用

供应链结果页统一使用参照／候选关系地图。比较表与地图候选控件共享当前查看方案；正式排名和报告推荐保持结果快照的原决策。可以按期间、运输段、节点及关系变化筛选，点击关系名称定位；坐标缺失的记录保留在列表。期间筛选只改变关系显示，距离卡片仍明确为全期指标。连线不是道路路线。

复用 `scripts/local_trial.py` 启动受控入口（默认页面 8865、求解 8887）。启动器核对首页字节和后端源码指纹，并拒绝受保护的 8787/8877/8791。Windows 实机与真实 OSRM 验收按用户安排留到 Windows 环境；本轮不切换原 Mac 服务。真人试用操作和记录要求见 `docs/HUMAN_TRIAL_SCRIPT.md`。
